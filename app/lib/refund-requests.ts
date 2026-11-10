import { RefundRequestStatus } from "~/db/schema";
import { formatPrice } from "~/lib/utils";

// The rules and wording for refund requests. Terms follow GLOSSARY.md.
// Everything here is pure; the database side is refund-requests.server.ts.

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

// The refund window is counted in whole calendar days, not hours — someone
// who buys at 23:00 still gets the whole of their fourteenth day.
export function calendarDay(when: Date): string {
  const year = when.getFullYear();
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function lastDayOfRefundWindow(purchasedAt: string): string {
  const deadline = new Date(purchasedAt);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

export type RefundEligibilityFacts = {
  purchasedAt: string;
  amountPaid: number;
  today: Date;
  secondsWatched: number;
  completedLessons: number;
  totalLessons: number;
  hasClaimedSeat: boolean;
  hasOpenRefundRequest: boolean;
  isRefundedPurchase: boolean;
};

export type RefundEligibility =
  | {
      eligible: true;
      refundableAmount: number;
      lastDayOfRefundWindow: string;
    }
  | { eligible: false; message: string };

/**
 * Refund eligibility, as GLOSSARY.md defines it. The course page and the
 * server action both call this, so they cannot disagree.
 */
export function checkRefundEligibility(
  facts: RefundEligibilityFacts
): RefundEligibility {
  if (facts.isRefundedPurchase) {
    return { eligible: false, message: "This purchase has already been refunded." };
  }

  if (facts.hasOpenRefundRequest) {
    return {
      eligible: false,
      message: "You already have a open refund request for this purchase.",
    };
  }

  // A seat that came out of a team licence, and has been claimed, belongs to
  // the team — the learner cannot hand it back on their own.
  if (facts.hasClaimedSeat) {
    return {
      eligible: false,
      message: "A claimed team seat cannot be refunded.",
    };
  }

  const today = calendarDay(facts.today);
  const lastDay = lastDayOfRefundWindow(facts.purchasedAt);
  const withinRefundWindow =
    today >= calendarDay(new Date(facts.purchasedAt)) && today <= lastDay;

  if (!withinRefundWindow) {
    return {
      eligible: false,
      message: `The ${REFUND_WINDOW_DAYS}-day refund window has closed.`,
    };
  }

  if (
    facts.totalLessons > 0 &&
    facts.completedLessons / facts.totalLessons >= REFUND_COMPLETION_LIMIT
  ) {
    return {
      eligible: false,
      message: "You have completed too much of this course to request a refund.",
    };
  }

  if (facts.secondsWatched >= REFUND_WATCH_LIMIT_SECONDS) {
    return {
      eligible: false,
      message: "You have watched too much of this course to request a refund.",
    };
  }

  return {
    eligible: true,
    // The refundable amount is always the amount paid — never the list price.
    refundableAmount: facts.amountPaid,
    lastDayOfRefundWindow: lastDay,
  };
}

export type RefundRequestEmailInput = {
  status: RefundRequestStatus;
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  refundableAmount: number;
  decisionNote: string | null;
};

const SUBJECT_STATUS: Record<RefundRequestStatus, string> = {
  [RefundRequestStatus.Open]: "received",
  [RefundRequestStatus.Approved]: "approved",
  [RefundRequestStatus.Declined]: "declined",
  [RefundRequestStatus.Withdrawn]: "withdrawn",
};

/**
 * The email a learner gets each time their refund request changes status.
 * There is no mail transport wired up yet, so callers log the result.
 */
export function buildRefundRequestEmail(input: RefundRequestEmailInput) {
  const amount = formatPrice(input.refundableAmount);
  const course = `"${input.courseTitle}"`;

  const bodyByStatus: Record<RefundRequestStatus, string[]> = {
    [RefundRequestStatus.Open]: [
      `We have your refund request for ${course}.`,
      `If it is approved, your refund will be ${amount}, the amount you paid.`,
      "",
      "A reviewer reads every refund request. You do not need to do anything else — we will email you again when we have decided.",
    ],
    [RefundRequestStatus.Approved]: [
      `Your refund request for ${course} has been approved.`,
      `Your refund of ${amount} to the card you paid with is pending. Your access to the course has ended.`,
    ],
    [RefundRequestStatus.Declined]: [
      `Your refund request for ${course} has been declined.`,
    ],
    [RefundRequestStatus.Withdrawn]: [
      `You withdrew your refund request for ${course}. You still have the course, and no refund will be made.`,
    ],
  };

  const body = [...bodyByStatus[input.status]];
  if (input.decisionNote) {
    body.push("", `A note from the reviewer: ${input.decisionNote}`);
  }

  return {
    to: input.learnerEmail,
    subject: `Refund request ${SUBJECT_STATUS[input.status]} — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      ...body,
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}
