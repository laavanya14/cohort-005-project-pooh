import { eq } from "drizzle-orm";
import { db } from "~/db";
import type { DbExecutor } from "~/db/executor";
import {
  comments,
  courses,
  lessons,
  modules,
  users,
  UserRole,
} from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import { notify } from "~/lib/notifications/notify.server";

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
      lessonTitle: lessons.title,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

type Comment = typeof comments.$inferSelect;
type LessonCourse = NonNullable<ReturnType<typeof getCourseForLesson>>;

/**
 * Tells the right person about a new comment. Only creating a comment
 * notifies; edits and deletes never do.
 */
function notifyCommentPosted(
  tx: DbExecutor,
  comment: Comment,
  parent: Comment | null,
  course: LessonCourse
) {
  const commenter = tx
    .select({ name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, comment.userId))
    .get();
  if (!commenter) return;

  const data = {
    lessonTitle: course.lessonTitle,
    courseTitle: course.courseTitle,
    commenterName: commenter.name,
    commentText: comment.body,
  };

  // The course's instructor and platform admins answer questions; they don't ask them.
  const answersQuestions =
    comment.userId === course.instructorId ||
    commenter.role === UserRole.PlatformAdmin;

  if (parent === null) {
    if (answersQuestions) return;
    notify(tx, {
      workflowKey: "student-top-level-comment",
      actorId: comment.userId,
      recipients: { userIds: [course.instructorId] },
      path: "/instructor/questions",
      data,
    });
    return;
  }

  // A reply from the instructor or a platform admin is an answer, worth an
  // email. A student's reply only reaches the inbox, whoever it replies to.
  notify(tx, {
    workflowKey: answersQuestions
      ? "instructor-or-platform-admin-reply"
      : "student-reply",
    actorId: comment.userId,
    recipients: { userIds: [parent.userId] },
    path: `/courses/${course.courseSlug}/lessons/${comment.lessonId}#comment-${comment.id}`,
    data,
  });
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

    notifyCommentPosted(tx, comment, parent, course);

    return { comment, parent, course };
  });
}

function getCommentById(commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

/** Changes the body of the person's own comment. Never notifies anyone. */
export function editComment(commentId: number, userId: number, body: string) {
  const trimmed = validateCommentBody(body);

  const existing = getCommentById(commentId);
  if (!existing) {
    throw new Error("Comment not found");
  }
  if (existing.deletedAt !== null) {
    throw new Error("Comment has been deleted");
  }
  if (existing.userId !== userId) {
    throw new Error("You can only edit your own comments");
  }

  return db
    .update(comments)
    .set({ body: trimmed, editedAt: new Date().toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();
}

/**
 * Deletes a comment, keeping its replies. The author can delete their own
 * comment; the course's instructor or a platform admin (`canModerate`) can
 * delete anyone's. Never notifies anyone.
 */
export function deleteComment(
  commentId: number,
  userId: number,
  canModerate: boolean
) {
  const existing = getCommentById(commentId);
  if (!existing) {
    throw new Error("Comment not found");
  }
  if (existing.userId !== userId && !canModerate) {
    throw new Error("You can only delete your own comments");
  }
  if (existing.deletedAt !== null) {
    return existing;
  }

  return db
    .update(comments)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();
}
