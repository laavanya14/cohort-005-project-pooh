import { data } from "react-router";
import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import type { DbExecutor } from "~/db/executor";
import { courses, enrollments, users } from "~/db/schema";
import { notify } from "~/lib/notifications/notify.server";

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
 * buying a course and claiming a seat both come through here. The course's
 * instructor gets a new enrollment notification.
 */
export function enroll(
  userId: number,
  courseId: number,
  executor: DbExecutor = db
) {
  return executor.transaction((tx) => {
    const course = tx
      .select({
        id: courses.id,
        title: courses.title,
        instructorId: courses.instructorId,
      })
      .from(courses)
      .where(eq(courses.id, courseId))
      .get();
    if (!course) {
      throw data("Course not found.", { status: 404 });
    }

    if (isEnrolled(userId, courseId, tx)) {
      throw data("You are already enrolled in this course.", { status: 409 });
    }

    const enrollment = tx
      .insert(enrollments)
      .values({ userId, courseId })
      .returning()
      .get();

    const student = tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (student) {
      notify(tx, {
        workflowKey: "new-enrollment",
        actorId: userId,
        recipients: { userIds: [course.instructorId] },
        path: `/instructor/${course.id}/students`,
        data: {
          courseId: course.id,
          courseTitle: course.title,
          studentName: student.name,
        },
      });
    }

    return enrollment;
  });
}
