import { data } from "react-router";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
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
  UserRole,
  videoWatchEvents,
} from "~/db/schema";
import {
  buildRefundRequestEmail,
  checkRefundEligibility,
  measureCourseProgress,
} from "~/lib/refund-requests";
import {
  archiveNotifications,
  notify,
} from "~/lib/notifications/notify.server";
import { claimedSeatFor, hasClaimedSeat, hasSeats } from "~/lib/seats.server";
import type { DbExecutor } from "~/db/executor";

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

/**
 * The buyer raises a refund request on their purchase. Every platform admin
 * is told there's a new open refund request, except the buyer themselves.
 */
export function createRefundRequest(purchaseId: number, reason: string) {
  return db.transaction((tx) => {
    const refundRequest = tx
      .insert(refundRequests)
      .values({ purchaseId, status: RefundRequestStatus.Open, reason })
      .returning()
      .get();

    notifyNewOpenRefundRequest(tx, refundRequest.id);

    return refundRequest;
  });
}

function notifyNewOpenRefundRequest(tx: DbExecutor, refundRequestId: number) {
  const raised = tx
    .select({
      reason: refundRequests.reason,
      buyerId: users.id,
      buyerName: users.name,
      courseTitle: courses.title,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .where(eq(refundRequests.id, refundRequestId))
    .get();

  if (!raised) return;

  notify(tx, {
    workflowKey: "new-open-refund-request",
    actorId: raised.buyerId,
    recipients: { role: UserRole.PlatformAdmin },
    path: "/admin/refund-requests",
    data: {
      refundRequestId,
      buyerName: raised.buyerName,
      courseTitle: raised.courseTitle,
      reason: raised.reason,
    },
  });
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
 * Log the email confirming the buyer raised or withdrew their refund request.
 * There is no mail transport wired up yet. A decided refund request is a
 * notification instead (refund-request-decided), not a logged email.
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

/**
 * Tells the buyer their refund request was decided. Cadence speaks for the
 * reviewer, who is the actor, so they never get it themselves.
 */
function notifyRefundRequestDecided(
  tx: DbExecutor,
  reviewerId: number,
  refundRequestId: number
) {
  const decided = tx
    .select({
      status: refundRequests.status,
      decisionNote: refundRequests.decisionNote,
      buyerId: purchases.userId,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refundRequests.id, refundRequestId))
    .get();

  if (!decided) return;

  notify(tx, {
    workflowKey: "refund-request-decided",
    actorId: reviewerId,
    recipients: { userIds: [decided.buyerId] },
    path: `/courses/${decided.courseSlug}`,
    data: {
      outcome:
        decided.status === RefundRequestStatus.Approved
          ? "approved"
          : "declined",
      courseTitle: decided.courseTitle,
      decisionNote: decided.decisionNote,
    },
  });
}

/**
 * Once a refund request is decided or withdrawn, every platform admin's new
 * open refund request for it is archived together.
 */
function archiveNewOpenRefundRequest(tx: DbExecutor, refundRequestId: number) {
  archiveNotifications(tx, {
    workflowKey: "new-open-refund-request",
    key: "refundRequestId",
    value: refundRequestId,
  });
}

/**
 * The student closes their own open refund request. No refund is made, and
 * nobody is notified.
 */
export function withdrawRefundRequest(
  studentId: number,
  refundRequestId: number
) {
  const { purchase } = requireOpenRefundRequest(refundRequestId);

  if (purchase.userId !== studentId) {
    throw data("Refund request not found.", { status: 404 });
  }

  db.transaction((tx) => {
    tx.update(refundRequests)
      .set({
        status: RefundRequestStatus.Withdrawn,
        withdrawnAt: new Date().toISOString(),
      })
      .where(eq(refundRequests.id, refundRequestId))
      .run();

    archiveNewOpenRefundRequest(tx, refundRequestId);
  });

  sendRefundRequestEmail(refundRequestId);
}

/**
 * Ends the access an approved refund request's purchase gave, and tells the
 * course's instructor (never with the buyer's reason). Nothing ends, and
 * nobody is told, when:
 * - the purchase is a team licence: it gave the buyer no access, and
 *   approving it changes nobody's enrollment (ADR 0001);
 * - the buyer claimed a seat on the course, so they keep access through it;
 * - the buyer has no enrollment left to end.
 */
function endRefundedEnrollment(
  tx: DbExecutor,
  reviewerId: number,
  purchase: typeof purchases.$inferSelect
) {
  const isTeamLicence = hasSeats(purchase.id, tx);
  const buyerClaimedSeat = !!claimedSeatFor(
    purchase.userId,
    purchase.courseId,
    tx
  );

  if (isTeamLicence || buyerClaimedSeat) return;

  const { changes } = tx
    .delete(enrollments)
    .where(
      and(
        eq(enrollments.userId, purchase.userId),
        eq(enrollments.courseId, purchase.courseId)
      )
    )
    .run();

  if (changes === 0) return;

  const ended = tx
    .select({
      courseTitle: courses.title,
      instructorId: courses.instructorId,
      studentName: users.name,
    })
    .from(courses)
    .innerJoin(users, eq(users.id, purchase.userId))
    .where(eq(courses.id, purchase.courseId))
    .get();

  if (!ended) return;

  notify(tx, {
    workflowKey: "enrollment-ended",
    actorId: reviewerId,
    recipients: { userIds: [ended.instructorId] },
    path: `/instructor/${purchase.courseId}/students`,
    data: {
      courseId: purchase.courseId,
      courseTitle: ended.courseTitle,
      studentName: ended.studentName,
    },
  });
}

/**
 * A reviewer approves an open refund request. The refund is the amount
 * paid, and the purchase becomes a refunded purchase: its enrollment is
 * removed, so it no longer grants access to the course, unless the buyer
 * keeps access through a claimed seat, or the purchase is a team licence
 * (see `endRefundedEnrollment`). Course progress is untouched, so a student
 * who buys the course again picks up where they left off.
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

    notifyRefundRequestDecided(tx, reviewerId, refundRequestId);
    archiveNewOpenRefundRequest(tx, refundRequestId);

    endRefundedEnrollment(tx, reviewerId, purchase);
  });
}

/** A reviewer declines an open refund request, with a decision note. */
export function declineRefundRequest(
  reviewerId: number,
  refundRequestId: number,
  decisionNote: string
) {
  requireOpenRefundRequest(refundRequestId);

  db.transaction((tx) => {
    tx.update(refundRequests)
      .set({
        status: RefundRequestStatus.Declined,
        decidedAt: new Date().toISOString(),
        decidedByUserId: reviewerId,
        decisionNote,
      })
      .where(eq(refundRequests.id, refundRequestId))
      .run();

    notifyRefundRequestDecided(tx, reviewerId, refundRequestId);
    archiveNewOpenRefundRequest(tx, refundRequestId);
  });
}
