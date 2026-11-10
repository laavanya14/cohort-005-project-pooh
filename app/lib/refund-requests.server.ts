import { data } from "react-router";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  LessonProgressStatus,
  modules,
  purchases,
  refundRequests,
  RefundRequestStatus,
  users,
  videoWatchEvents,
} from "~/db/schema";
import {
  buildRefundRequestEmail,
  checkRefundEligibility,
  measureCourseProgress,
} from "~/lib/refund-requests";

// The database side of refund requests. The rules themselves live in
// refund-requests.ts; this file only gathers the facts and writes the results.

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(desc(purchases.createdAt))
    .get();
}

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function getCompletedLessonCount(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.status, LessonProgressStatus.Completed),
          inArray(lessonProgress.lessonId, lessonIds)
        )
      )
      .get()?.count ?? 0
  );
}

function getSecondsWatched(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  return db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all()
    .reduce((total, row) => total + row.furthest, 0);
}

function hasRefundRequestWithStatus(
  purchaseId: number,
  status: RefundRequestStatus
) {
  return !!db
    .select({ id: refundRequests.id })
    .from(refundRequests)
    .where(
      and(
        eq(refundRequests.purchaseId, purchaseId),
        eq(refundRequests.status, status)
      )
    )
    .get();
}

function hasClaimedSeat(purchaseId: number) {
  return !!db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
    )
    .get();
}

/**
 * Refund eligibility for the student's latest purchase of a course, or null
 * when they have not bought it.
 */
export function getRefundEligibility(userId: number, courseId: number) {
  const purchase = getLatestPurchase(userId, courseId);
  if (!purchase) return null;

  const lessonIds = getLessonIdsForCourse(courseId);

  const eligibility = checkRefundEligibility({
    purchasedAt: purchase.createdAt,
    amountPaid: purchase.amountPaid,
    today: new Date(),
    secondsWatched: getSecondsWatched(userId, lessonIds),
    completedLessons: getCompletedLessonCount(userId, lessonIds),
    totalLessons: lessonIds.length,
    hasClaimedSeat: hasClaimedSeat(purchase.id),
    hasOpenRefundRequest: hasRefundRequestWithStatus(
      purchase.id,
      RefundRequestStatus.Open
    ),
    isRefundedPurchase: hasRefundRequestWithStatus(
      purchase.id,
      RefundRequestStatus.Approved
    ),
  });

  return { purchase, eligibility };
}

export function createRefundRequest(purchaseId: number, reason: string) {
  return db
    .insert(refundRequests)
    .values({ purchaseId, status: RefundRequestStatus.Open, reason })
    .returning()
    .get();
}

const refundRequestColumns = {
  id: refundRequests.id,
  status: refundRequests.status,
  reason: refundRequests.reason,
  decisionNote: refundRequests.decisionNote,
  requestedAt: refundRequests.requestedAt,
  decidedAt: refundRequests.decidedAt,
  withdrawnAt: refundRequests.withdrawnAt,
  refundableAmount: purchases.amountPaid,
  courseId: courses.id,
  courseTitle: courses.title,
  courseSlug: courses.slug,
  studentId: users.id,
  studentName: users.name,
  studentEmail: users.email,
};

function selectRefundRequests() {
  return db
    .select(refundRequestColumns)
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id));
}

export function listRefundRequestsForStudent(studentId: number) {
  return selectRefundRequests()
    .where(eq(purchases.userId, studentId))
    .orderBy(desc(refundRequests.requestedAt))
    .all();
}

/** The student's course progress as it is now, against the refund limits. */
function getCourseProgress(studentId: number, courseId: number) {
  const lessonIds = getLessonIdsForCourse(courseId);

  return measureCourseProgress({
    secondsWatched: getSecondsWatched(studentId, lessonIds),
    completedLessons: getCompletedLessonCount(studentId, lessonIds),
    totalLessons: lessonIds.length,
  });
}

/**
 * Open refund requests first (oldest first), each with the student's current
 * course progress, then recent decisions.
 */
export function listRefundRequestsForReview() {
  const open = selectRefundRequests()
    .where(eq(refundRequests.status, RefundRequestStatus.Open))
    .orderBy(refundRequests.requestedAt)
    .all()
    .map((request) => ({
      ...request,
      courseProgress: getCourseProgress(request.studentId, request.courseId),
    }));

  const decided = selectRefundRequests()
    .where(isNotNull(refundRequests.decidedAt))
    .orderBy(desc(refundRequests.decidedAt))
    .limit(20)
    .all();

  return { open, decided };
}

function getRefundRequest(refundRequestId: number) {
  return selectRefundRequests()
    .where(eq(refundRequests.id, refundRequestId))
    .get();
}

/**
 * Log the email for the refund request's current status. There is no mail
 * transport wired up yet.
 */
export function sendRefundRequestEmail(refundRequestId: number) {
  const request = getRefundRequest(refundRequestId);
  if (!request) return;

  const email = buildRefundRequestEmail({
    status: request.status,
    studentName: request.studentName,
    studentEmail: request.studentEmail,
    courseTitle: request.courseTitle,
    refundableAmount: request.refundableAmount,
    decisionNote: request.decisionNote,
  });

  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);
}

function requireOpenRefundRequest(refundRequestId: number) {
  const row = db
    .select({ request: refundRequests, purchase: purchases })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .where(eq(refundRequests.id, refundRequestId))
    .get();

  if (!row) {
    throw data("Refund request not found.", { status: 404 });
  }

  if (row.request.status !== RefundRequestStatus.Open) {
    throw data("This refund request is no longer open.", { status: 409 });
  }

  return row;
}

/** The student closes their own open refund request. No refund is made. */
export function withdrawRefundRequest(
  studentId: number,
  refundRequestId: number
) {
  const { purchase } = requireOpenRefundRequest(refundRequestId);

  if (purchase.userId !== studentId) {
    throw data("Refund request not found.", { status: 404 });
  }

  db.update(refundRequests)
    .set({
      status: RefundRequestStatus.Withdrawn,
      withdrawnAt: new Date().toISOString(),
    })
    .where(eq(refundRequests.id, refundRequestId))
    .run();

  sendRefundRequestEmail(refundRequestId);
}

/**
 * A reviewer approves an open refund request. The refund is the amount
 * paid, and the purchase becomes a refunded purchase: its enrollment is
 * removed, so it no longer grants access to the course.
 */
export function approveRefundRequest(
  reviewerId: number,
  refundRequestId: number,
  decisionNote: string | null
) {
  const { purchase } = requireOpenRefundRequest(refundRequestId);

  db.transaction((tx) => {
    tx.update(refundRequests)
      .set({
        status: RefundRequestStatus.Approved,
        amountRefunded: purchase.amountPaid,
        decidedAt: new Date().toISOString(),
        decidedByUserId: reviewerId,
        decisionNote,
      })
      .where(eq(refundRequests.id, refundRequestId))
      .run();

    tx.delete(enrollments)
      .where(
        and(
          eq(enrollments.userId, purchase.userId),
          eq(enrollments.courseId, purchase.courseId)
        )
      )
      .run();
  });

  sendRefundRequestEmail(refundRequestId);
}

/** A reviewer declines an open refund request, with a decision note. */
export function declineRefundRequest(
  reviewerId: number,
  refundRequestId: number,
  decisionNote: string
) {
  requireOpenRefundRequest(refundRequestId);

  db.update(refundRequests)
    .set({
      status: RefundRequestStatus.Declined,
      decidedAt: new Date().toISOString(),
      decidedByUserId: reviewerId,
      decisionNote,
    })
    .where(eq(refundRequests.id, refundRequestId))
    .run();

  sendRefundRequestEmail(refundRequestId);
}
