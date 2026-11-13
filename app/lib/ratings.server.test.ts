import { describe, it, expect } from "vitest";
import { db } from "~/db";
import { seedBaseData } from "~/test/setup";
import { testDb } from "~/test/test-db";
import { getRating, rateCourse } from "./ratings.server";

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
