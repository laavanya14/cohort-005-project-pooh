import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import { enrollments } from "~/db/schema";
import { sendNotificationJobs } from "~/lib/notifications/outbox.server";
import { createRecordingTransport } from "~/test/recording-transport";
import { seedBaseData } from "~/test/setup";
import { testDb } from "~/test/test-db";
import { enroll } from "./enrollments.server";

function isEnrolled(userId: number, courseId: number) {
  return !!testDb()
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

function enrollmentCount(userId: number, courseId: number) {
  return testDb()
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .all().length;
}

/** What Knock is asked to do when the outbox sends its waiting jobs. */
async function sendToKnock() {
  const knock = createRecordingTransport();
  await sendNotificationJobs({ transport: knock });
  return knock.triggers;
}

describe("enroll", () => {
  it("enrolls the student in the course", () => {
    const { user: student, course } = seedBaseData(testDb());

    const enrollment = enroll(student.id, course.id);

    expect(enrollment).toMatchObject({
      userId: student.id,
      courseId: course.id,
    });
    expect(isEnrolled(student.id, course.id)).toBe(true);
  });

  it("refuses a student who is already enrolled in the course", () => {
    const { user: student, course } = seedBaseData(testDb());
    enroll(student.id, course.id);

    expect(() => enroll(student.id, course.id)).toThrow(
      expect.objectContaining({ init: { status: 409 } })
    );
    expect(enrollmentCount(student.id, course.id)).toBe(1);
  });

  it("joins the caller's transaction, so nothing is kept when the caller rolls back", () => {
    const { user: student, course } = seedBaseData(testDb());

    expect(() =>
      db.transaction((tx) => {
        enroll(student.id, course.id, tx);
        throw new Error("The caller's next step failed.");
      })
    ).toThrow("The caller's next step failed.");
    expect(isEnrolled(student.id, course.id)).toBe(false);
  });

  it("refuses a course that doesn't exist", () => {
    const { user: student } = seedBaseData(testDb());

    expect(() => enroll(student.id, 9999)).toThrow(
      expect.objectContaining({ init: { status: 404 } })
    );
  });
});

describe("the new enrollment notification", () => {
  it("tells the course's instructor who enrolled, opening the course's students page", async () => {
    const { user: student, instructor, course } = seedBaseData(testDb());

    enroll(student.id, course.id);

    expect(await sendToKnock()).toEqual([
      expect.objectContaining({
        workflowKey: "new-enrollment",
        recipients: [
          {
            id: String(instructor.id),
            name: "Test Instructor",
            email: "instructor@example.com",
          },
        ],
        actor: expect.objectContaining({ id: String(student.id) }),
        data: {
          courseId: course.id,
          courseTitle: "Test Course",
          studentName: "Test User",
          path: `/instructor/${course.id}/students`,
          notificationId: expect.any(String),
          pushPath: expect.any(String),
        },
      }),
    ]);
  });

  it("isn't sent when the instructor enrolls in their own course", async () => {
    const { instructor, course } = seedBaseData(testDb());

    enroll(instructor.id, course.id);

    expect(await sendToKnock()).toEqual([]);
  });

  it("isn't sent when the caller rolls back", async () => {
    const { user: student, course } = seedBaseData(testDb());

    expect(() =>
      db.transaction((tx) => {
        enroll(student.id, course.id, tx);
        throw new Error("The caller's next step failed.");
      })
    ).toThrow("The caller's next step failed.");
    expect(await sendToKnock()).toEqual([]);
  });
});
