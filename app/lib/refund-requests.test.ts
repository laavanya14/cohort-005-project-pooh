import { describe, it, expect } from "vitest";
import { RefundRequestStatus } from "~/db/schema";
import {
  buildRefundRequestEmail,
  checkRefundEligibility,
  measureCourseProgress,
  type RefundEligibilityFacts,
} from "./refund-requests";

// Local times (no "Z") so the calendar-day rules do not depend on the
// timezone the tests run in.
const PURCHASED_AT = "2026-11-01T23:00:00";

function facts(overrides: Partial<RefundEligibilityFacts> = {}) {
  return {
    purchasedAt: PURCHASED_AT,
    amountPaid: 2500,
    today: new Date("2026-11-05T09:00:00"),
    secondsWatched: 0,
    completedLessons: 0,
    totalLessons: 10,
    hasClaimedSeat: false,
    hasOpenRefundRequest: false,
    isRefundedPurchase: false,
    ...overrides,
  } satisfies RefundEligibilityFacts;
}

describe("checkRefundEligibility", () => {
  it("offers the amount paid as the refundable amount", () => {
    // The refundable amount is always the amount paid, whatever discount
    // produced it — never the course's list price.
    expect(checkRefundEligibility(facts())).toEqual({
      eligible: true,
      refundableAmount: 2500,
      lastDayOfRefundWindow: "2026-11-15",
    });
  });

  it("keeps the whole fourteenth calendar day inside the refund window", () => {
    const lastDay = facts({ today: new Date("2026-11-15T23:59:00") });
    const dayAfter = facts({ today: new Date("2026-11-16T00:01:00") });

    expect(checkRefundEligibility(lastDay).eligible).toBe(true);
    expect(checkRefundEligibility(dayAfter)).toEqual({
      eligible: false,
      message: "The 14-day refund window has closed.",
    });
  });

  it("refuses once half the lessons are completed", () => {
    expect(
      checkRefundEligibility(facts({ completedLessons: 4 })).eligible
    ).toBe(true);
    expect(checkRefundEligibility(facts({ completedLessons: 5 }))).toEqual({
      eligible: false,
      message: "You have completed too much of this course to request a refund.",
    });
  });

  it("does not divide by zero for a course with no lessons", () => {
    expect(
      checkRefundEligibility(facts({ totalLessons: 0 })).eligible
    ).toBe(true);
  });

  it("refuses once two hours have been watched", () => {
    expect(
      checkRefundEligibility(facts({ secondsWatched: 2 * 60 * 60 - 1 }))
        .eligible
    ).toBe(true);
    expect(
      checkRefundEligibility(facts({ secondsWatched: 2 * 60 * 60 }))
    ).toEqual({
      eligible: false,
      message: "You have watched too much of this course to request a refund.",
    });
  });

  it("refuses a claimed team seat", () => {
    expect(checkRefundEligibility(facts({ hasClaimedSeat: true }))).toEqual({
      eligible: false,
      message: "A claimed team seat cannot be refunded.",
    });
  });

  it("refuses a second refund request while one is open", () => {
    expect(
      checkRefundEligibility(facts({ hasOpenRefundRequest: true })).eligible
    ).toBe(false);
  });

  it("refuses a refunded purchase", () => {
    expect(
      checkRefundEligibility(facts({ isRefundedPurchase: true })).eligible
    ).toBe(false);
  });
});

describe("measureCourseProgress", () => {
  it("reports hours watched and lessons completed under both limits", () => {
    expect(
      measureCourseProgress({
        secondsWatched: 100 * 60,
        completedLessons: 6,
        totalLessons: 20,
      })
    ).toEqual({
      secondsWatched: 6000,
      completedLessons: 6,
      totalLessons: 20,
      completedShare: 0.3,
      overWatchLimit: false,
      overCompletionLimit: false,
    });
  });

  it("is over the watch limit from exactly two hours", () => {
    const justUnder = { secondsWatched: 2 * 60 * 60 - 1, completedLessons: 0, totalLessons: 10 };
    const atLimit = { ...justUnder, secondsWatched: 2 * 60 * 60 };

    expect(measureCourseProgress(justUnder).overWatchLimit).toBe(false);
    expect(measureCourseProgress(atLimit).overWatchLimit).toBe(true);
  });

  it("is over the completion limit from exactly half the lessons", () => {
    const justUnder = { secondsWatched: 0, completedLessons: 4, totalLessons: 10 };
    const atLimit = { ...justUnder, completedLessons: 5 };

    expect(measureCourseProgress(justUnder).overCompletionLimit).toBe(false);
    expect(measureCourseProgress(atLimit).overCompletionLimit).toBe(true);
  });

  it("treats a course with no lessons as nothing completed", () => {
    expect(
      measureCourseProgress({ secondsWatched: 0, completedLessons: 0, totalLessons: 0 })
    ).toMatchObject({ completedShare: 0, overCompletionLimit: false });
  });

  it("agrees with refund eligibility on where the limits are", () => {
    // A request the reviewer sees as over a limit is one the student could no
    // longer make — the two must never drift apart.
    const cases = [
      { secondsWatched: 7199, completedLessons: 4 },
      { secondsWatched: 7200, completedLessons: 4 },
      { secondsWatched: 7199, completedLessons: 5 },
    ];

    for (const progress of cases) {
      const measured = measureCourseProgress({ ...progress, totalLessons: 10 });
      const eligibility = checkRefundEligibility(facts(progress));
      expect(eligibility.eligible).toBe(
        !measured.overWatchLimit && !measured.overCompletionLimit
      );
    }
  });
});

describe("buildRefundRequestEmail", () => {
  const base = {
    studentName: "Sophia",
    studentEmail: "sophia@example.com",
    courseTitle: "Intro to TypeScript",
    refundableAmount: 2500,
    decisionNote: null,
  };

  it.each([
    [RefundRequestStatus.Open, "Refund request received — Intro to TypeScript"],
    [RefundRequestStatus.Approved, "Refund request approved — Intro to TypeScript"],
    [RefundRequestStatus.Declined, "Refund request declined — Intro to TypeScript"],
    [RefundRequestStatus.Withdrawn, "Refund request withdrawn — Intro to TypeScript"],
  ])("titles the %s email with the glossary pattern", (status, subject) => {
    expect(buildRefundRequestEmail({ ...base, status }).subject).toBe(subject);
  });

  it("states the refundable amount when the request is received", () => {
    const email = buildRefundRequestEmail({
      ...base,
      status: RefundRequestStatus.Open,
    });
    expect(email.to).toBe("sophia@example.com");
    expect(email.body).toContain("$25.00");
  });

  it("tells the student their refund is pending once approved", () => {
    const email = buildRefundRequestEmail({
      ...base,
      status: RefundRequestStatus.Approved,
    });
    expect(email.body).toContain("Your refund of $25.00");
    expect(email.body).toContain("is pending");
  });

  it("includes the reviewer's decision note", () => {
    const email = buildRefundRequestEmail({
      ...base,
      status: RefundRequestStatus.Declined,
      decisionNote: "The refund window had closed.",
    });
    expect(email.body).toContain("The refund window had closed.");
  });

  it("never uses words the glossary tells us to avoid", () => {
    for (const status of Object.values(RefundRequestStatus)) {
      const { subject, body } = buildRefundRequestEmail({ ...base, status });
      expect(`${subject}\n${body}`).not.toMatch(/reversal|chargeback|cancel/i);
    }
  });
});
