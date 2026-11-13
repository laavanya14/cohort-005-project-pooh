import { eq } from "drizzle-orm";
import { db } from "~/db";
import type { DbExecutor } from "~/db/executor";
import { comments, courses, lessons, modules } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";

// Rule failures throw a plain Error with a message the person can act on. The
// routes catch it and show the message, so it must stay user-facing.

/** The comment body, trimmed, or an Error when it's empty or too long. */
export function validateCommentBody(body: string) {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

function getCourseForLesson(lessonId: number, executor: DbExecutor) {
  return executor
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

/**
 * Posts a comment on a lesson: a top-level comment, or a reply to one.
 * Replies are one level deep. The one place a comment is created, from the
 * lesson page and the instructor questions page.
 *
 * The result has the new comment, the comment it replies to (null for a
 * top-level comment) and the lesson's course with its instructor.
 */
export function createComment(
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  executor: DbExecutor = db
) {
  const trimmed = validateCommentBody(body);

  return executor.transaction((tx) => {
    const course = getCourseForLesson(lessonId, tx);
    if (!course) throw new Error("Lesson not found");

    const parent =
      parentId === null
        ? null
        : tx.select().from(comments).where(eq(comments.id, parentId)).get();

    if (parent === undefined) {
      throw new Error("Parent comment not found");
    }
    if (parent && parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (parent && parent.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }

    const comment = tx
      .insert(comments)
      .values({ userId, lessonId, parentId, body: trimmed })
      .returning()
      .get();

    return { comment, parent, course };
  });
}
