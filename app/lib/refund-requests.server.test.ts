import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  enrollments,
  purchases,
  refundRequests,
  RefundRequestStatus,
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
  return knock.triggers;
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

    expect(await sendToKnock()).toEqual([
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
    const [approval] = await sendToKnock();

    resetTestDb();

    const declined = seedOpenRefundRequest();
    declineRefundRequest(
      declined.reviewer.id,
      declined.refundRequest.id,
      "Most lessons watched."
    );
    const [decline] = await sendToKnock();

    expect(approval).toMatchObject({
      workflowKey: "refund-request-decided",
      data: {
        outcome: "approved",
        courseTitle: "Test Course",
        decisionNote: "Sorry it wasn't a fit.",
        path: "/courses/test-course",
        notificationId: expect.any(String),
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

    expect(await sendToKnock()).toEqual([]);
  });

  it("names the reviewer as the actor, and never as a recipient", async () => {
    const { reviewer, refundRequest } = seedOpenRefundRequest();

    approveRefundRequest(reviewer.id, refundRequest.id, null);

    const [decided] = await sendToKnock();
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
    expect(await sendToKnock()).toEqual([]);
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

    const [a, b] = await sendToKnock();
    expect(a.data.notificationId).not.toBe(b.data.notificationId);
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
