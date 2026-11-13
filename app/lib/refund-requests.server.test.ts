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
import { seedBaseData } from "~/test/setup";
import { testDb } from "~/test/test-db";
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
