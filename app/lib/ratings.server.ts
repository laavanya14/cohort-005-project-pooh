import { data } from "react-router";
import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import type { DbExecutor } from "~/db/executor";
import { courseRatings, courses, users } from "~/db/schema";
import { notify } from "~/lib/notifications/notify.server";
import { MAX_RATING, MIN_RATING } from "~/lib/ratings";

function findRating(userId: number, courseId: number, executor: DbExecutor) {
  return executor
    .select()
    .from(courseRatings)
    .where(
      and(
        eq(courseRatings.userId, userId),
        eq(courseRatings.courseId, courseId)
      )
    )
    .get();
}

/** The student's star rating of the course, or null if they haven't rated it. */
export function getRating(userId: number, courseId: number) {
  return findRating(userId, courseId, db)?.rating ?? null;
}

/** Whether a rating is the student's first, a different value, or a repeat. */
export type RatingChange = "new" | "changed" | "same";

/**
 * A student rates a course, replacing any earlier rating. The one place a
 * rating is written. The result says whether the rating was new, changed, or
 * the same as before. A new or changed rating notifies the course's
 * instructor; the same rating again notifies nobody.
 */
export function rateCourse(
  userId: number,
  courseId: number,
  rating: number,
  executor: DbExecutor = db
): { change: RatingChange; rating: typeof courseRatings.$inferSelect } {
  if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
    throw data(
      `Rating must be a whole number between ${MIN_RATING} and ${MAX_RATING}.`,
      { status: 400 }
    );
  }

  return executor.transaction((tx) => {
    const course = tx
      .select({
        id: courses.id,
        title: courses.title,
        slug: courses.slug,
        instructorId: courses.instructorId,
      })
      .from(courses)
      .where(eq(courses.id, courseId))
      .get();
    if (!course) {
      throw data("Course not found.", { status: 404 });
    }

    const existing = findRating(userId, courseId, tx);

    const result: {
      change: RatingChange;
      rating: typeof courseRatings.$inferSelect;
    } = existing
      ? {
          change: existing.rating === rating ? "same" : "changed",
          rating: tx
            .update(courseRatings)
            .set({ rating, updatedAt: new Date().toISOString() })
            .where(eq(courseRatings.id, existing.id))
            .returning()
            .get(),
        }
      : {
          change: "new",
          rating: tx
            .insert(courseRatings)
            .values({ userId, courseId, rating })
            .returning()
            .get(),
        };

    const student = tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (result.change !== "same" && student) {
      notify(tx, {
        workflowKey: "new-or-changed-rating",
        actorId: userId,
        recipients: { userIds: [course.instructorId] },
        path: `/courses/${course.slug}`,
        data: {
          courseId: course.id,
          courseTitle: course.title,
          studentName: student.name,
          rating,
        },
      });
    }

    return result;
  });
}
