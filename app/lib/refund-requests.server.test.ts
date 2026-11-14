import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  coupons,
  enrollments,
  purchases,
  refundRequests,
  RefundRequestStatus,
  teams,
  users,
  UserRole,
} from "~/db/schema";
import { sendNotificationJobs } from "~/lib/notifications/outbox.server";
import { createRecordingTransport } from "~/test/recording-transport";
import { seedBaseData } from "~/test/setup";
import { resetTestDb, testDb } from "~/test/test-db";
import {
  approveRefundRequest,
  createRefundRequest,
  declineRefundRequest,
  listRefundRequestsForStudent,
  withdrawRefundRequest,
} from "./refund-requests.server";

/**
 * A student who bought and is enrolled in a course, with an open refund
 * request on that purchase, and a platform admin to review it.
 */
function seedOpenRefundRequest() {
  const { user: student, course } = seedBaseData(testDb());

  const reviewer = testDb()
    .insert(users)
    .values({
      name: "Platform Admin",
      email: "admin@example.com",
      role: UserRole.PlatformAdmin,
    })
    .returning()
    .get();

  const purchase = testDb()
    .insert(purchases)
    .values({ userId: student.id, courseId: course.id, amountPaid: 2500 })
    .returning()
    .get();

  testDb()
    .insert(enrollments)
    .values({ userId: student.id, courseId: course.id })
    .run();

  const refundRequest = createRefundRequest(purchase.id, "Not what I expected.");

  return { student, reviewer, course, refundRequest };
}

type OpenRefundRequest = ReturnType<typeof seedOpenRefundRequest>;

function buyPurchase(userId: number, courseId: number) {
  return testDb()
    .insert(purchases)
    .values({ userId, courseId, amountPaid: 2500 })
    .returning()
    .get();
}

function refundRequestOf(studentId: number) {
  const [request] = listRefundRequestsForStudent(studentId);
  return request;
}

/** Who decided the refund request. Only stored, not shown by a read yet. */
function deciderOf(refundRequestId: number) {
  return testDb()
    .select({ decidedByUserId: refundRequests.decidedByUserId })
    .from(refundRequests)
    .where(eq(refundRequests.id, refundRequestId))
    .get()?.decidedByUserId;
}

function isEnrolled(userId: number, courseId: number) {
  return !!testDb()
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

/** What Knock is asked to do when the outbox sends its waiting jobs. */
async function sendToKnock() {
  const knock = createRecordingTransport();
  await sendNotificationJobs({ transport: knock });
  return knock;
}

/** The workflows of one kind Knock is asked to run. */
async function triggersOf(workflowKey: string) {
  const knock = await sendToKnock();
  return knock.triggers.filter((t) => t.workflowKey === workflowKey);
}

function addPlatformAdmin(name: string, email: string) {
  return testDb()
    .insert(users)
    .values({ name, email, role: UserRole.PlatformAdmin })
    .returning()
    .get();
}

beforeEach(() => {
  // The refund request email is logged, not sent. Keep test output quiet.
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("approveRefundRequest", () => {
  it("approves the refund request and records the reviewer and decision note", () => {
    const { student, reviewer, refundRequest } = seedOpenRefundRequest();

    approveRefundRequest(reviewer.id, refundRequest.id, "Sorry it wasn't a fit.");

    expect(refundRequestOf(student.id)).toMatchObject({
      status: RefundRequestStatus.Approved,
      decisionNote: "Sorry it wasn't a fit.",
      decidedAt: expect.any(String),
    });
    expect(deciderOf(refundRequest.id)).toBe(reviewer.id);
  });

  it("removes the student's enrollment, so the purchase no longer grants access", () => {
    const { student, reviewer, course, refundRequest } = seedOpenRefundRequest();

    approveRefundRequest(reviewer.id, refundRequest.id, null);

    expect(isEnrolled(student.id, course.id)).toBe(false);
  });
});

describe("declineRefundRequest", () => {
  it("declines the refund request and records the reviewer and decision note", () => {
    const { student, reviewer, refundRequest } = seedOpenRefundRequest();

    declineRefundRequest(reviewer.id, refundRequest.id, "Most lessons watched.");

    expect(refundRequestOf(student.id)).toMatchObject({
      status: RefundRequestStatus.Declined,
      decisionNote: "Most lessons watched.",
      decidedAt: expect.any(String),
    });
    expect(deciderOf(refundRequest.id)).toBe(reviewer.id);
  });

  it("keeps the student's enrollment", () => {
    const { student, reviewer, course, refundRequest } = seedOpenRefundRequest();

    declineRefundRequest(reviewer.id, refundRequest.id, "Most lessons watched.");

    expect(isEnrolled(student.id, course.id)).toBe(true);
  });
});

describe("withdrawRefundRequest", () => {
  it("withdraws the student's own refund request without a decision", () => {
    const { student, course, refundRequest } = seedOpenRefundRequest();

    withdrawRefundRequest(student.id, refundRequest.id);

    expect(refundRequestOf(student.id)).toMatchObject({
      status: RefundRequestStatus.Withdrawn,
      withdrawnAt: expect.any(String),
      decidedAt: null,
      decisionNote: null,
    });
    expect(isEnrolled(student.id, course.id)).toBe(true);
  });

  it("notifies nobody: not the buyer, the platform admins or the instructor", async () => {
    const { student, refundRequest } = seedOpenRefundRequest();
    addPlatformAdmin("Second Admin", "second@example.com");
    await sendToKnock();

    withdrawRefundRequest(student.id, refundRequest.id);

    expect((await sendToKnock()).triggers).toEqual([]);
  });

  it("refuses another student's refund request as not found", () => {
    const { refundRequest } = seedOpenRefundRequest();
    const otherStudent = testDb()
      .insert(users)
      .values({
        name: "Other Student",
        email: "other@example.com",
        role: UserRole.Student,
      })
      .returning()
      .get();

    expect(() =>
      withdrawRefundRequest(otherStudent.id, refundRequest.id)
    ).toThrow(expect.objectContaining({ init: { status: 404 } }));
  });
});

describe("the refund request decided notification", () => {
  it("goes to the buyer when a reviewer approves their refund request", async () => {
    const { student, reviewer, refundRequest } = seedOpenRefundRequest();

    approveRefundRequest(reviewer.id, refundRequest.id, null);

    expect(await triggersOf("refund-request-decided")).toEqual([
      expect.objectContaining({
        workflowKey: "refund-request-decided",
        recipients: [
          {
            id: String(student.id),
            name: "Test User",
            email: "test@example.com",
          },
        ],
      }),
    ]);
  });

  it("uses one workflow for both outcomes, with the outcome, course and decision note in its data", async () => {
    const approved = seedOpenRefundRequest();
    approveRefundRequest(
      approved.reviewer.id,
      approved.refundRequest.id,
      "Sorry it wasn't a fit."
    );
    const [approval] = await triggersOf("refund-request-decided");

    resetTestDb();

    const declined = seedOpenRefundRequest();
    declineRefundRequest(
      declined.reviewer.id,
      declined.refundRequest.id,
      "Most lessons watched."
    );
    const [decline] = await triggersOf("refund-request-decided");

    expect(approval).toMatchObject({
      workflowKey: "refund-request-decided",
      data: {
        outcome: "approved",
        courseTitle: "Test Course",
        decisionNote: "Sorry it wasn't a fit.",
        path: "/courses/test-course",
        notificationId: expect.any(String),
        pushPath: expect.any(String),
      },
    });
    expect(decline).toMatchObject({
      workflowKey: "refund-request-decided",
      data: {
        outcome: "declined",
        courseTitle: "Test Course",
        decisionNote: "Most lessons watched.",
        path: "/courses/test-course",
        notificationId: expect.any(String),
        pushPath: expect.any(String),
      },
    });
  });

  it("never goes to the reviewer who decided it, even on their own refund request", async () => {
    const { reviewer, course } = seedOpenRefundRequest();
    const reviewersPurchase = testDb()
      .insert(purchases)
      .values({ userId: reviewer.id, courseId: course.id, amountPaid: 2500 })
      .returning()
      .get();
    const reviewersRequest = createRefundRequest(
      reviewersPurchase.id,
      "Bought it by mistake."
    );

    declineRefundRequest(reviewer.id, reviewersRequest.id, "Policy applies.");

    expect(await triggersOf("refund-request-decided")).toEqual([]);
  });

  it("names the reviewer as the actor, and never as a recipient", async () => {
    const { reviewer, refundRequest } = seedOpenRefundRequest();

    approveRefundRequest(reviewer.id, refundRequest.id, null);

    const [decided] = await triggersOf("refund-request-decided");
    expect(decided.actor).toEqual({
      id: String(reviewer.id),
      name: "Platform Admin",
      email: "admin@example.com",
    });
    expect(decided.recipients.map((person) => person.id)).not.toContain(
      String(reviewer.id)
    );
  });

  it("isn't sent when the decision rolls back", async () => {
    const { student, reviewer, refundRequest } = seedOpenRefundRequest();
    // Make the approval fail partway, after the refund request is updated.
    testDb().$client.exec(`
      CREATE TRIGGER enrollments_cannot_be_removed BEFORE DELETE ON enrollments
      BEGIN SELECT RAISE(ABORT, 'enrollments cannot be removed'); END;
    `);

    expect(() =>
      approveRefundRequest(reviewer.id, refundRequest.id, null)
    ).toThrow("enrollments cannot be removed");

    expect(refundRequestOf(student.id).status).toBe(RefundRequestStatus.Open);
    expect(await triggersOf("refund-request-decided")).toEqual([]);
  });

  it("replaces the decided email in the server log, while withdrawing still logs its email", () => {
    const log = vi.mocked(console.log);
    const decided = seedOpenRefundRequest();
    approveRefundRequest(decided.reviewer.id, decided.refundRequest.id, null);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("[email]"));

    resetTestDb();

    const withdrawn = seedOpenRefundRequest();
    withdrawRefundRequest(withdrawn.student.id, withdrawn.refundRequest.id);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("subject=Refund request withdrawn")
    );
  });

  it("gives each notification its own id", async () => {
    const first = seedOpenRefundRequest();
    const secondPurchase = testDb()
      .insert(purchases)
      .values({
        userId: first.student.id,
        courseId: first.course.id,
        amountPaid: 2500,
      })
      .returning()
      .get();
    const second = createRefundRequest(secondPurchase.id, "Changed my mind.");

    declineRefundRequest(first.reviewer.id, first.refundRequest.id, "No.");
    declineRefundRequest(first.reviewer.id, second.id, "Still no.");

    const [a, b] = await triggersOf("refund-request-decided");
    expect(a.data.notificationId).not.toBe(b.data.notificationId);
  });
});

describe("the new open refund request notification", () => {
  /** A buyer of the course, not yet asking for a refund, and two platform admins. */
  function seedPurchaseAndAdmins() {
    const { user: buyer, course } = seedBaseData(testDb());
    const firstAdmin = addPlatformAdmin("First Admin", "first@example.com");
    const secondAdmin = addPlatformAdmin("Second Admin", "second@example.com");
    const purchase = buyPurchase(buyer.id, course.id);
    return { buyer, course, purchase, firstAdmin, secondAdmin };
  }

  it("goes to every platform admin when a buyer raises a refund request", async () => {
    const { buyer, purchase, firstAdmin, secondAdmin } =
      seedPurchaseAndAdmins();

    const raised = createRefundRequest(purchase.id, "Bought it twice.");

    const [notification] = await triggersOf("new-open-refund-request");
    expect(notification).toMatchObject({
      actor: { id: String(buyer.id), name: "Test User" },
      data: {
        refundRequestId: raised.id,
        buyerName: "Test User",
        courseTitle: "Test Course",
        reason: "Bought it twice.",
        path: "/admin/refund-requests",
        notificationId: expect.any(String),
        pushPath: expect.any(String),
      },
    });
    expect(notification.recipients).toEqual([
      { id: String(firstAdmin.id), name: "First Admin", email: "first@example.com" },
      { id: String(secondAdmin.id), name: "Second Admin", email: "second@example.com" },
    ]);
  });

  it("goes to whoever is a platform admin when the refund request is raised, not when the purchase was made", async () => {
    const { purchase, firstAdmin, secondAdmin } = seedPurchaseAndAdmins();
    const promoted = testDb()
      .insert(users)
      .values({
        name: "Promoted Admin",
        email: "promoted@example.com",
        role: UserRole.Student,
      })
      .returning()
      .get();
    testDb()
      .update(users)
      .set({ role: UserRole.PlatformAdmin })
      .where(eq(users.id, promoted.id))
      .run();
    testDb()
      .update(users)
      .set({ role: UserRole.Student })
      .where(eq(users.id, secondAdmin.id))
      .run();

    createRefundRequest(purchase.id, "Bought it twice.");

    const [notification] = await triggersOf("new-open-refund-request");
    expect(notification.recipients.map((person) => person.id)).toEqual([
      String(firstAdmin.id),
      String(promoted.id),
    ]);
  });

  it("doesn't go to a platform admin who raises a refund request on their own purchase", async () => {
    const { course, firstAdmin, secondAdmin } = seedPurchaseAndAdmins();
    const adminsPurchase = buyPurchase(firstAdmin.id, course.id);

    createRefundRequest(adminsPurchase.id, "Bought it by mistake.");

    const [notification] = await triggersOf("new-open-refund-request");
    expect(notification.recipients.map((person) => person.id)).toEqual([
      String(secondAdmin.id),
    ]);
  });
});

describe("archiving every platform admin's new open refund request", () => {
  const closings = [
    [
      "a reviewer approves it",
      ({ reviewer, refundRequest }: OpenRefundRequest) =>
        approveRefundRequest(reviewer.id, refundRequest.id, null),
    ],
    [
      "a reviewer declines it",
      ({ reviewer, refundRequest }: OpenRefundRequest) =>
        declineRefundRequest(reviewer.id, refundRequest.id, "Policy applies."),
    ],
    [
      "the buyer withdraws it",
      ({ student, refundRequest }: OpenRefundRequest) =>
        withdrawRefundRequest(student.id, refundRequest.id),
    ],
  ] as const;

  it.each(closings)(
    "archives every copy, selected by refundRequestId, once %s",
    async (_, close) => {
      const open = seedOpenRefundRequest();
      await sendToKnock();

      close(open);

      const knock = await sendToKnock();
      expect(knock.archives).toEqual([
        {
          workflowKey: "new-open-refund-request",
          key: "refundRequestId",
          value: open.refundRequest.id,
        },
      ]);
    }
  );

  it.each(closings)(
    "archives only after Knock accepts the notification, when %s before it reached Knock",
    async (_, close) => {
      const knock = createRecordingTransport();
      const open = seedOpenRefundRequest();
      close(open);
      const start = new Date();

      // Knock is down for the new open refund request's trigger.
      knock.failNext();
      await sendNotificationJobs({ transport: knock, now: start });
      expect(knock.archives).toEqual([]);

      await sendNotificationJobs({
        transport: knock,
        now: new Date(start.getTime() + 2 * 60 * 1000),
      });
      const aboutThisRequest = knock.calls
        .filter(
          (call) =>
            "workflowKey" in call &&
            call.workflowKey === "new-open-refund-request"
        )
        .map((call) => call.method);
      expect(aboutThisRequest).toEqual(["trigger", "bulkArchive"]);
    }
  );
});

/**
 * A team licence for the course bought by `buyerId`, with `seats` seats,
 * none claimed.
 */
function seedTeamLicence(buyerId: number, courseId: number, seats = 2) {
  const team = testDb().insert(teams).values({}).returning().get();
  const teamLicence = testDb()
    .insert(purchases)
    .values({ userId: buyerId, courseId, amountPaid: 2500 * seats })
    .returning()
    .get();

  for (let seat = 1; seat <= seats; seat++) {
    testDb()
      .insert(coupons)
      .values({
        teamId: team.id,
        courseId,
        code: `SEAT-${teamLicence.id}-${seat}`,
        purchaseId: teamLicence.id,
      })
      .run();
  }

  return teamLicence;
}

/** Approves the refund request and keeps only the enrollment-ended triggers. */
async function enrollmentEndedAfterApproving(
  reviewerId: number,
  refundRequestId: number
) {
  approveRefundRequest(reviewerId, refundRequestId, null);
  return (await sendToKnock()).triggers.filter(
    (trigger) => trigger.workflowKey === "enrollment-ended"
  );
}

describe("the enrollment ended notification", () => {
  it("tells the course's instructor whose enrollment ended, opening the course's students page", async () => {
    const { student, reviewer, course, refundRequest } =
      seedOpenRefundRequest();
    const instructorId = course.instructorId;

    expect(
      await enrollmentEndedAfterApproving(reviewer.id, refundRequest.id)
    ).toEqual([
      expect.objectContaining({
        recipients: [
          {
            id: String(instructorId),
            name: "Test Instructor",
            email: "instructor@example.com",
          },
        ],
        data: {
          courseId: course.id,
          courseTitle: "Test Course",
          studentName: "Test User",
          path: `/instructor/${course.id}/students`,
          notificationId: expect.any(String),
          pushPath: expect.any(String),
        },
      }),
    ]);
    expect(isEnrolled(student.id, course.id)).toBe(false);
  });

  it("never shows the buyer's reason to the instructor", async () => {
    const { reviewer, refundRequest } = seedOpenRefundRequest();

    const [ended] = await enrollmentEndedAfterApproving(
      reviewer.id,
      refundRequest.id
    );

    expect(ended).toBeDefined();
    expect(JSON.stringify(ended)).not.toContain("Not what I expected.");
  });

  it("isn't sent, and access stays, when the buyer also claimed a seat on the course", async () => {
    const { student, reviewer, course, refundRequest } =
      seedOpenRefundRequest();
    const seatLicence = seedTeamLicence(reviewer.id, course.id, 1);
    testDb()
      .update(coupons)
      .set({ redeemedByUserId: student.id, redeemedAt: new Date().toISOString() })
      .where(eq(coupons.purchaseId, seatLicence.id))
      .run();

    expect(
      await enrollmentEndedAfterApproving(reviewer.id, refundRequest.id)
    ).toEqual([]);
    expect(isEnrolled(student.id, course.id)).toBe(true);
  });

  it("isn't sent for a team licence, and the team admin's own enrollment stays", async () => {
    const { student: teamAdmin, reviewer, course } = seedOpenRefundRequest();
    const teamLicence = seedTeamLicence(teamAdmin.id, course.id);
    const teamLicenceRequest = createRefundRequest(
      teamLicence.id,
      "We no longer need it."
    );

    expect(
      await enrollmentEndedAfterApproving(reviewer.id, teamLicenceRequest.id)
    ).toEqual([]);
    expect(isEnrolled(teamAdmin.id, course.id)).toBe(true);
  });

  it("isn't sent when the buyer had no enrollment left to end", async () => {
    const { student, reviewer, course, refundRequest } =
      seedOpenRefundRequest();
    testDb()
      .delete(enrollments)
      .where(
        and(
          eq(enrollments.userId, student.id),
          eq(enrollments.courseId, course.id)
        )
      )
      .run();

    expect(
      await enrollmentEndedAfterApproving(reviewer.id, refundRequest.id)
    ).toEqual([]);
  });

  it("isn't sent when a decline keeps the enrollment", async () => {
    const { reviewer, refundRequest } = seedOpenRefundRequest();

    declineRefundRequest(reviewer.id, refundRequest.id, "Most lessons watched.");

    expect(
      (await sendToKnock()).triggers.map((trigger) => trigger.workflowKey)
    ).not.toContain("enrollment-ended");
  });
});

describe("a refund request that isn't open", () => {
  const notOpen = expect.objectContaining({
    data: "This refund request is no longer open.",
    init: { status: 409 },
  });

  it("can't be approved, declined or withdrawn once it's decided", () => {
    const { student, reviewer, refundRequest } = seedOpenRefundRequest();
    declineRefundRequest(reviewer.id, refundRequest.id, "Most lessons watched.");

    expect(() =>
      approveRefundRequest(reviewer.id, refundRequest.id, null)
    ).toThrow(notOpen);
    expect(() =>
      declineRefundRequest(reviewer.id, refundRequest.id, "Again.")
    ).toThrow(notOpen);
    expect(() => withdrawRefundRequest(student.id, refundRequest.id)).toThrow(
      notOpen
    );
    expect(refundRequestOf(student.id).status).toBe(
      RefundRequestStatus.Declined
    );
  });

  it("can't be approved once it's withdrawn, and the enrollment stays", () => {
    const { student, reviewer, course, refundRequest } = seedOpenRefundRequest();
    withdrawRefundRequest(student.id, refundRequest.id);

    expect(() =>
      approveRefundRequest(reviewer.id, refundRequest.id, null)
    ).toThrow(notOpen);
    expect(isEnrolled(student.id, course.id)).toBe(true);
  });
});
