import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  enrollments,
  purchases,
  teamMembers,
  TeamMemberRole,
  teams,
  users,
  UserRole,
} from "~/db/schema";
import { seedBaseData } from "~/test/setup";
import { testDb } from "~/test/test-db";
import { claimSeat } from "./seats.server";

/**
 * A team admin who bought a team licence for the course, with its seats, and
 * a student with the seat link for the first seat.
 */
function seedTeamLicence(
  overrides: { seatCount?: number; country?: string | null } = {}
) {
  const { seatCount = 3, country = "GB" } = overrides;
  const { user: student, course } = seedBaseData(testDb());

  const teamAdmin = testDb()
    .insert(users)
    .values({
      name: "Team Admin",
      email: "team-admin@example.com",
      role: UserRole.Student,
    })
    .returning()
    .get();

  const team = testDb().insert(teams).values({}).returning().get();
  testDb()
    .insert(teamMembers)
    .values({
      teamId: team.id,
      userId: teamAdmin.id,
      role: TeamMemberRole.TeamAdmin,
    })
    .run();

  const teamLicence = testDb()
    .insert(purchases)
    .values({
      userId: teamAdmin.id,
      courseId: course.id,
      amountPaid: 9000,
      country,
    })
    .returning()
    .get();

  const seats = Array.from({ length: seatCount }, (_, i) =>
    testDb()
      .insert(coupons)
      .values({
        teamId: team.id,
        courseId: course.id,
        purchaseId: teamLicence.id,
        code: `seat-link-${i + 1}`,
      })
      .returning()
      .get()
  );

  return { student, teamAdmin, course, seats };
}

function addStudent(email: string) {
  return testDb()
    .insert(users)
    .values({ name: email, email, role: UserRole.Student })
    .returning()
    .get();
}

function isEnrolled(userId: number, courseId: number) {
  return !!testDb()
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

/** Who claimed the seat, or null while it's available. */
function claimedBy(seatId: number) {
  return testDb()
    .select({ redeemedByUserId: coupons.redeemedByUserId })
    .from(coupons)
    .where(eq(coupons.id, seatId))
    .get()?.redeemedByUserId;
}

describe("claimSeat", () => {
  it("claims the seat for the student and enrolls them in the course", () => {
    const { student, course, seats } = seedTeamLicence();

    const result = claimSeat(seats[0].code, student.id, "GB");

    expect(result).toMatchObject({
      ok: true,
      seat: { id: seats[0].id, redeemedByUserId: student.id },
      enrollment: { userId: student.id, courseId: course.id },
    });
    expect(isEnrolled(student.id, course.id)).toBe(true);
  });

  it("names the team licence's buyer as the team admin", () => {
    const { student, teamAdmin, seats } = seedTeamLicence();

    const result = claimSeat(seats[0].code, student.id, "GB");

    expect(result).toMatchObject({ ok: true, teamAdminId: teamAdmin.id });
  });

  it("says when the claimed seat was the last available one on the team licence", () => {
    const { student, seats } = seedTeamLicence({ seatCount: 2 });
    const secondStudent = addStudent("second@example.com");

    const first = claimSeat(seats[0].code, student.id, "GB");
    const last = claimSeat(seats[1].code, secondStudent.id, "GB");

    expect(first).toMatchObject({ ok: true, wasLastAvailableSeat: false });
    expect(last).toMatchObject({ ok: true, wasLastAvailableSeat: true });
  });

  it("counts only the seats on the same team licence", () => {
    const { student, teamAdmin, course, seats } = seedTeamLicence({
      seatCount: 1,
    });
    const otherLicence = testDb()
      .insert(purchases)
      .values({ userId: teamAdmin.id, courseId: course.id, amountPaid: 3000 })
      .returning()
      .get();
    testDb()
      .insert(coupons)
      .values({
        teamId: seats[0].teamId,
        courseId: course.id,
        purchaseId: otherLicence.id,
        code: "other-licence-seat",
      })
      .run();

    const result = claimSeat(seats[0].code, student.id, "GB");

    expect(result).toMatchObject({ ok: true, wasLastAvailableSeat: true });
  });

  it("joins the caller's transaction, so the seat stays available when the caller rolls back", () => {
    const { student, course, seats } = seedTeamLicence();

    expect(() =>
      db.transaction((tx) => {
        claimSeat(seats[0].code, student.id, "GB", tx);
        throw new Error("The caller's next step failed.");
      })
    ).toThrow("The caller's next step failed.");
    expect(claimedBy(seats[0].id)).toBeNull();
    expect(isEnrolled(student.id, course.id)).toBe(false);
  });

  it("refuses a seat link that doesn't exist", () => {
    const { student } = seedTeamLicence();

    expect(claimSeat("no-such-link", student.id, "GB")).toEqual({
      ok: false,
      error: "Coupon not found",
    });
  });

  it("refuses a seat that is already claimed, and keeps the first claim", () => {
    const { student, course, seats } = seedTeamLicence();
    const latecomer = addStudent("latecomer@example.com");
    claimSeat(seats[0].code, student.id, "GB");

    expect(claimSeat(seats[0].code, latecomer.id, "GB")).toEqual({
      ok: false,
      error: "Coupon has already been redeemed",
    });
    expect(isEnrolled(latecomer.id, course.id)).toBe(false);
    expect(claimedBy(seats[0].id)).toBe(student.id);
  });

  it("refuses a student already enrolled in the course, and leaves the seat available", () => {
    const { student, course, seats } = seedTeamLicence();
    testDb()
      .insert(enrollments)
      .values({ userId: student.id, courseId: course.id })
      .run();

    expect(claimSeat(seats[0].code, student.id, "GB")).toEqual({
      ok: false,
      error: "You are already enrolled in this course",
    });
    expect(claimedBy(seats[0].id)).toBeNull();
  });

  it("refuses a student in a different country from the team licence's buyer", () => {
    const { student, course, seats } = seedTeamLicence({ country: "GB" });

    expect(claimSeat(seats[0].code, student.id, "IN")).toEqual({
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    });
    expect(isEnrolled(student.id, course.id)).toBe(false);
    expect(claimedBy(seats[0].id)).toBeNull();
  });

  it("lets a student in any country claim a seat on a team licence with no country", () => {
    const { student, seats } = seedTeamLicence({ country: null });

    expect(claimSeat(seats[0].code, student.id, "IN")).toMatchObject({
      ok: true,
    });
  });
});
