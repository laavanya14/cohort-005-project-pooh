import { describe, it, expect } from "vitest";
import { db } from "~/db";
import { comments, lessons, modules, users, UserRole } from "~/db/schema";
import { sendNotificationJobs } from "~/lib/notifications/outbox.server";
import { createRecordingTransport } from "~/test/recording-transport";
import { seedBaseData } from "~/test/setup";
import { testDb } from "~/test/test-db";
import { createComment, deleteComment, editComment } from "./comments.server";

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

type Seeded = ReturnType<typeof seedLessons>;

function addUser(name: string, role: UserRole) {
  return testDb()
    .insert(users)
    .values({
      name,
      email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
      role,
    })
    .returning()
    .get();
}

/** What Knock is asked to do when the outbox sends its waiting jobs. */
async function sendToKnock() {
  const knock = createRecordingTransport();
  await sendNotificationJobs({ transport: knock });
  return knock.triggers;
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

describe("comment notifications", () => {
  it("tells the course's instructor about a student's top-level comment, linking to their questions page", async () => {
    const { student, instructor, lesson } = seedLessons();

    createComment(student.id, lesson.id, null, "How do I start?");

    expect(await sendToKnock()).toEqual([
      expect.objectContaining({
        workflowKey: "student-top-level-comment",
        recipients: [
          {
            id: String(instructor.id),
            name: "Test Instructor",
            email: "instructor@example.com",
          },
        ],
        actor: expect.objectContaining({ id: String(student.id) }),
        data: {
          notificationId: expect.any(String),
          pushPath: expect.any(String),
          path: "/instructor/questions",
          lessonTitle: "Lesson 1",
          courseTitle: "Test Course",
          commenterName: "Test User",
          commentText: "How do I start?",
        },
      }),
    ]);
  });

  it.each([
    ["the course's instructor", (seeded: Seeded) => seeded.instructor],
    [
      "a platform admin",
      () => addUser("Platform Admin", UserRole.PlatformAdmin),
    ],
  ])("tells nobody about a top-level comment by %s", async (_, author) => {
    const seeded = seedLessons();
    const { lesson } = seeded;
    const commenter = author(seeded);

    createComment(commenter.id, lesson.id, null, "Welcome to the lesson.");

    expect(await sendToKnock()).toEqual([]);
  });

  it.each([
    ["the course's instructor", (seeded: Seeded) => seeded.instructor],
    [
      "a platform admin",
      () => addUser("Platform Admin", UserRole.PlatformAdmin),
    ],
  ])(
    "tells the comment's author about a reply from %s, linking to the reply on the lesson",
    async (_, replier) => {
      const seeded = seedLessons();
      const { student, course, lesson } = seeded;
      const answerer = replier(seeded);
      const { comment: question } = createComment(
        student.id,
        lesson.id,
        null,
        "How do I start?"
      );
      await sendToKnock();

      const { comment: reply } = createComment(
        answerer.id,
        lesson.id,
        question.id,
        "Open the first lesson."
      );

      expect(await sendToKnock()).toEqual([
        expect.objectContaining({
          workflowKey: "instructor-or-platform-admin-reply",
          recipients: [
            {
              id: String(student.id),
              name: "Test User",
              email: "test@example.com",
            },
          ],
          actor: expect.objectContaining({ id: String(answerer.id) }),
          data: {
            notificationId: expect.any(String),
            pushPath: expect.any(String),
            path: `/courses/${course.slug}/lessons/${lesson.id}#comment-${reply.id}`,
            lessonTitle: "Lesson 1",
            courseTitle: "Test Course",
            commenterName: answerer.name,
            commentText: "Open the first lesson.",
          },
        }),
      ]);
    }
  );

  it("opens the reply from its push, with the notification id before the anchor", async () => {
    const { student, instructor, course, lesson } = seedLessons();
    const { comment: question } = createComment(
      student.id,
      lesson.id,
      null,
      "How do I start?"
    );
    await sendToKnock();

    const { comment: reply } = createComment(
      instructor.id,
      lesson.id,
      question.id,
      "Open the first lesson."
    );

    const [trigger] = await sendToKnock();
    expect(trigger?.data.pushPath).toBe(
      `/courses/${course.slug}/lessons/${lesson.id}` +
        `?notification=${String(trigger?.data.notificationId)}` +
        `#comment-${reply.id}`
    );
  });

  it.each([
    [
      "a student",
      (seeded: Seeded) => seeded.student,
      { name: "Test User", email: "test@example.com" },
    ],
    [
      "the course's instructor",
      (seeded: Seeded) => seeded.instructor,
      { name: "Test Instructor", email: "instructor@example.com" },
    ],
    [
      "a platform admin",
      () => addUser("Platform Admin", UserRole.PlatformAdmin),
      { name: "Platform Admin", email: "platform.admin@example.com" },
    ],
  ])(
    "tells the comment's author, %s, about a student's reply with the inbox-only workflow",
    async (_, author, person) => {
      const seeded = seedLessons();
      const { course, lesson } = seeded;
      const commenter = author(seeded);
      const otherStudent = addUser("Other Student", UserRole.Student);
      const { comment: original } = createComment(
        commenter.id,
        lesson.id,
        null,
        "Here's a tip for this lesson."
      );
      await sendToKnock();

      const { comment: reply } = createComment(
        otherStudent.id,
        lesson.id,
        original.id,
        "Thanks, that helped."
      );

      expect(await sendToKnock()).toEqual([
        expect.objectContaining({
          workflowKey: "student-reply",
          recipients: [{ id: String(commenter.id), ...person }],
          actor: expect.objectContaining({ id: String(otherStudent.id) }),
          data: {
            notificationId: expect.any(String),
            pushPath: expect.any(String),
            path: `/courses/${course.slug}/lessons/${lesson.id}#comment-${reply.id}`,
            lessonTitle: "Lesson 1",
            courseTitle: "Test Course",
            commenterName: "Other Student",
            commentText: "Thanks, that helped.",
          },
        }),
      ]);
    }
  );

  it.each([
    ["a student", (seeded: Seeded) => seeded.student],
    ["the course's instructor", (seeded: Seeded) => seeded.instructor],
    [
      "a platform admin",
      () => addUser("Platform Admin", UserRole.PlatformAdmin),
    ],
  ])("tells nobody when %s replies to their own comment", async (_, author) => {
    const seeded = seedLessons();
    const commenter = author(seeded);
    const { comment: original } = createComment(
      commenter.id,
      seeded.lesson.id,
      null,
      "A note on this lesson."
    );
    await sendToKnock();

    createComment(
      commenter.id,
      seeded.lesson.id,
      original.id,
      "One more thing."
    );

    expect(await sendToKnock()).toEqual([]);
  });

  it("tells nobody when a comment or a reply is edited", async () => {
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
    await sendToKnock();

    editComment(question.id, student.id, "How do I start this lesson?");
    editComment(
      reply.id,
      instructor.id,
      "Open the first lesson, then the video."
    );

    expect(await sendToKnock()).toEqual([]);
  });

  it("tells nobody when a comment or a reply is deleted", async () => {
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
    await sendToKnock();

    deleteComment(reply.id, instructor.id, true);
    deleteComment(question.id, student.id, false);

    expect(await sendToKnock()).toEqual([]);
  });

  it("tells nobody about a comment whose caller rolls back", async () => {
    const { student, lesson } = seedLessons();

    expect(() =>
      db.transaction((tx) => {
        createComment(student.id, lesson.id, null, "How do I start?", tx);
        throw new Error("The caller's next step failed.");
      })
    ).toThrow("The caller's next step failed.");

    expect(await sendToKnock()).toEqual([]);
  });
});
