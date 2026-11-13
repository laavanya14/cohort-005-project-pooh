import { describe, it, expect } from "vitest";
import { db } from "~/db";
import { comments, lessons, modules } from "~/db/schema";
import { seedBaseData } from "~/test/setup";
import { testDb } from "~/test/test-db";
import { createComment } from "./comments.server";

/** A student and the instructor of a course with two lessons. */
function seedLessons() {
  const { user: student, instructor, course } = seedBaseData(testDb());

  const module = testDb()
    .insert(modules)
    .values({ courseId: course.id, title: "Module 1", position: 1 })
    .returning()
    .get();

  const [lesson, otherLesson] = [1, 2].map((position) =>
    testDb()
      .insert(lessons)
      .values({ moduleId: module.id, title: `Lesson ${position}`, position })
      .returning()
      .get()
  );

  return { student, instructor, course, lesson, otherLesson };
}

function commentCount() {
  return testDb().select().from(comments).all().length;
}

describe("createComment", () => {
  it("posts a student's top-level comment on the lesson, with the course it belongs to", () => {
    const { student, instructor, course, lesson } = seedLessons();

    const result = createComment(
      student.id,
      lesson.id,
      null,
      "  How do I start?  "
    );

    expect(result).toMatchObject({
      comment: {
        userId: student.id,
        lessonId: lesson.id,
        parentId: null,
        body: "How do I start?",
      },
      parent: null,
      course: { courseId: course.id, instructorId: instructor.id },
    });
  });

  it("posts a reply to a top-level comment, with the comment it replies to", () => {
    const { student, instructor, lesson } = seedLessons();
    const { comment: question } = createComment(
      student.id,
      lesson.id,
      null,
      "How do I start?"
    );

    const result = createComment(
      instructor.id,
      lesson.id,
      question.id,
      "Open the first lesson."
    );

    expect(result).toMatchObject({
      comment: { userId: instructor.id, parentId: question.id },
      parent: { id: question.id, userId: student.id },
    });
  });

  it("accepts a comment of exactly the longest allowed length", () => {
    const { student, lesson } = seedLessons();

    const { comment } = createComment(
      student.id,
      lesson.id,
      null,
      "a".repeat(5000)
    );

    expect(comment.body).toHaveLength(5000);
  });

  it.each([
    ["an empty comment", "", "Comment cannot be empty"],
    ["a comment of only spaces", "   \n ", "Comment cannot be empty"],
    [
      "a comment over 5000 characters",
      "a".repeat(5001),
      "Comment must be 5000 characters or fewer",
    ],
  ])("refuses %s and posts nothing", (_, body, message) => {
    const { student, lesson } = seedLessons();

    expect(() => createComment(student.id, lesson.id, null, body)).toThrow(
      message
    );
    expect(commentCount()).toBe(0);
  });

  it("refuses a reply to a reply, so replies stay one level deep", () => {
    const { student, instructor, lesson } = seedLessons();
    const { comment: question } = createComment(
      student.id,
      lesson.id,
      null,
      "How do I start?"
    );
    const { comment: reply } = createComment(
      instructor.id,
      lesson.id,
      question.id,
      "Open the first lesson."
    );

    expect(() =>
      createComment(student.id, lesson.id, reply.id, "Thanks!")
    ).toThrow("Replies can only be one level deep");
    expect(commentCount()).toBe(2);
  });

  it("refuses a reply to a comment on a different lesson", () => {
    const { student, lesson, otherLesson } = seedLessons();
    const { comment: question } = createComment(
      student.id,
      otherLesson.id,
      null,
      "How do I start?"
    );

    expect(() =>
      createComment(student.id, lesson.id, question.id, "Me too.")
    ).toThrow("Parent comment belongs to a different lesson");
  });

  it("refuses a reply to a comment that doesn't exist", () => {
    const { student, lesson } = seedLessons();

    expect(() => createComment(student.id, lesson.id, 9999, "Me too.")).toThrow(
      "Parent comment not found"
    );
  });

  it("refuses a lesson that doesn't exist", () => {
    const { student } = seedLessons();

    expect(() => createComment(student.id, 9999, null, "Hello?")).toThrow(
      "Lesson not found"
    );
  });

  it("joins the caller's transaction, so nothing is posted when the caller rolls back", () => {
    const { student, lesson } = seedLessons();

    expect(() =>
      db.transaction((tx) => {
        createComment(student.id, lesson.id, null, "How do I start?", tx);
        throw new Error("The caller's next step failed.");
      })
    ).toThrow("The caller's next step failed.");
    expect(commentCount()).toBe(0);
  });
});
