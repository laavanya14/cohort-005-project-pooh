import { describe, it, expect } from "vitest";
import { db } from "~/db";
import { sendNotificationJobs } from "~/lib/notifications/outbox.server";
import { createRecordingTransport } from "~/test/recording-transport";
import { seedBaseData } from "~/test/setup";
import { testDb } from "~/test/test-db";
import { getRating, rateCourse } from "./ratings.server";

/** What Knock is asked to do when the outbox sends its waiting jobs. */
async function sendToKnock() {
  const knock = createRecordingTransport();
  await sendNotificationJobs({ transport: knock });
  return knock.triggers;
}

describe("rateCourse", () => {
  it("records a student's first rating of a course as new", () => {
    const { user: student, course } = seedBaseData(testDb());

    const result = rateCourse(student.id, course.id, 4);

    expect(result).toMatchObject({
      change: "new",
      rating: { userId: student.id, courseId: course.id, rating: 4 },
    });
    expect(getRating(student.id, course.id)).toBe(4);
  });

  it("replaces a student's earlier rating and calls it changed", () => {
    const { user: student, course } = seedBaseData(testDb());
    rateCourse(student.id, course.id, 4);

    const result = rateCourse(student.id, course.id, 2);

    expect(result).toMatchObject({ change: "changed", rating: { rating: 2 } });
    expect(getRating(student.id, course.id)).toBe(2);
  });

  it("calls a rating equal to the student's earlier one the same", () => {
    const { user: student, course } = seedBaseData(testDb());
    rateCourse(student.id, course.id, 4);

    const result = rateCourse(student.id, course.id, 4);

    expect(result).toMatchObject({ change: "same", rating: { rating: 4 } });
    expect(getRating(student.id, course.id)).toBe(4);
  });

  it.each([0, 6, 3.5])("refuses %s stars and records nothing", (stars) => {
    const { user: student, course } = seedBaseData(testDb());

    expect(() => rateCourse(student.id, course.id, stars)).toThrow(
      expect.objectContaining({ init: { status: 400 } })
    );
    expect(getRating(student.id, course.id)).toBeNull();
  });

  it("refuses a course that doesn't exist", () => {
    const { user: student } = seedBaseData(testDb());

    expect(() => rateCourse(student.id, 9999, 4)).toThrow(
      expect.objectContaining({ init: { status: 404 } })
    );
  });

  it("joins the caller's transaction, so nothing is kept when the caller rolls back", () => {
    const { user: student, course } = seedBaseData(testDb());

    expect(() =>
      db.transaction((tx) => {
        rateCourse(student.id, course.id, 4, tx);
        throw new Error("The caller's next step failed.");
      })
    ).toThrow("The caller's next step failed.");
    expect(getRating(student.id, course.id)).toBeNull();
  });
});

describe("the new or changed rating notification", () => {
  it("tells the course's instructor about a student's first rating, opening the course page", async () => {
    const { user: student, instructor, course } = seedBaseData(testDb());

    rateCourse(student.id, course.id, 4);

    expect(await sendToKnock()).toEqual([
      expect.objectContaining({
        workflowKey: "new-or-changed-rating",
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
          rating: 4,
          path: "/courses/test-course",
          notificationId: expect.any(String),
        },
      }),
    ]);
  });

  it("tells the instructor when a student changes their rating", async () => {
    const { user: student, course } = seedBaseData(testDb());
    rateCourse(student.id, course.id, 4);
    await sendToKnock();

    rateCourse(student.id, course.id, 2);

    expect(await sendToKnock()).toEqual([
      expect.objectContaining({
        workflowKey: "new-or-changed-rating",
        data: expect.objectContaining({ rating: 2 }),
      }),
    ]);
  });

  it("isn't sent when a student saves the same rating again", async () => {
    const { user: student, course } = seedBaseData(testDb());
    rateCourse(student.id, course.id, 4);
    await sendToKnock();

    rateCourse(student.id, course.id, 4);

    expect(await sendToKnock()).toEqual([]);
  });

  it("isn't sent when the instructor rates their own course", async () => {
    const { instructor, course } = seedBaseData(testDb());

    rateCourse(instructor.id, course.id, 5);

    expect(await sendToKnock()).toEqual([]);
  });
});
