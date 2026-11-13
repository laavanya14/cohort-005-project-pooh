import { and, eq, isNull } from "drizzle-orm";
import { db } from "~/db";
import type { DbExecutor } from "~/db/executor";
import { coupons, purchases } from "~/db/schema";
import { enroll, isEnrolled } from "~/lib/enrollments.server";

/**
 * A student claims a seat through its seat link, and is enrolled in the
 * seat's course. The one place a seat is claimed.
 *
 * The result tells the caller who the team admin is (the team licence's
 * buyer) and whether this was the last available seat on the team licence.
 */
export function claimSeat(
  code: string,
  userId: number,
  userCountry: string,
  executor: DbExecutor = db
) {
  return executor.transaction((tx) => {
    const seat = tx.select().from(coupons).where(eq(coupons.code, code)).get();
    if (!seat) return { ok: false as const, error: "Coupon not found" };

    if (seat.redeemedByUserId !== null) {
      return { ok: false as const, error: "Coupon has already been redeemed" };
    }

    if (isEnrolled(userId, seat.courseId, tx)) {
      return {
        ok: false as const,
        error: "You are already enrolled in this course",
      };
    }

    const teamLicence = tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, seat.purchaseId))
      .get();
    if (!teamLicence) return { ok: false as const, error: "Coupon not found" };

    if (teamLicence.country && teamLicence.country !== userCountry) {
      return {
        ok: false as const,
        error:
          "This coupon can only be redeemed from the same country as the purchaser",
      };
    }

    const claimedSeat = tx
      .update(coupons)
      .set({ redeemedByUserId: userId, redeemedAt: new Date().toISOString() })
      .where(eq(coupons.id, seat.id))
      .returning()
      .get();

    const enrollment = enroll(userId, seat.courseId, tx);

    const availableSeat = tx
      .select({ id: coupons.id })
      .from(coupons)
      .where(
        and(
          eq(coupons.purchaseId, teamLicence.id),
          isNull(coupons.redeemedByUserId)
        )
      )
      .get();

    return {
      ok: true as const,
      seat: claimedSeat,
      enrollment,
      teamAdminId: teamLicence.userId,
      wasLastAvailableSeat: !availableSeat,
    };
  });
}
