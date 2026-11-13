import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import { enrollments } from "~/db/schema";
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
