import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund-request";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import {
  createRefundRequest,
  getRefundEligibility,
  sendRefundRequestEmail,
} from "~/lib/refund-requests.server";

const refundRequestParamsSchema = z.object({
  slug: z.string().min(1),
});

const refundRequestActionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in to request a refund.", { status: 401 });
  }

  const { slug } = parseParams(params, refundRequestParamsSchema);
  const course = db.select().from(courses).where(eq(courses.slug, slug)).get();

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const refund = getRefundEligibility(currentUserId, course.id);

  if (!refund) {
    throw data("You have not bought this course.", { status: 403 });
  }

  if (!refund.eligibility.eligible) {
    throw data(refund.eligibility.message, { status: 403 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundRequestActionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const refundRequest = createRefundRequest(
    refund.purchase.id,
    parsed.data.reason
  );
  sendRefundRequestEmail(refundRequest.id);

  return redirect("/settings");
}
