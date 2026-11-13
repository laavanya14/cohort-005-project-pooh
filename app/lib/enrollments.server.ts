import { data } from "react-router";
import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import type { DbExecutor } from "~/db/executor";
import { courses, enrollments } from "~/db/schema";

export function isEnrolled(
  userId: number,
  courseId: number,
  executor: DbExecutor = db
) {
  return !!executor
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

/**
 * Enrolls a student in a course. The one place an enrollment is created:
 * buying a course and claiming a seat both come through here.
 */
export function enroll(
  userId: number,
  courseId: number,
  executor: DbExecutor = db
) {
  return executor.transaction((tx) => {
    const course = tx
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.id, courseId))
      .get();
    if (!course) {
      throw data("Course not found.", { status: 404 });
    }

    if (isEnrolled(userId, courseId, tx)) {
      throw data("You are already enrolled in this course.", { status: 409 });
    }

    return tx
      .insert(enrollments)
      .values({ userId, courseId })
      .returning()
      .get();
  });
}
