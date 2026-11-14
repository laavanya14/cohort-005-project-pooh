import { redirect } from "react-router";
import { z } from "zod";
import { db } from "~/db";
import type { DbExecutor } from "~/db/executor";
import {
  enqueueNotificationJob,
  sendNotificationJobsSoon,
} from "./outbox.server";
import { PUSH_CLICK_PARAM } from "./push-click";

const notificationIdSchema = z.string().trim().min(1).max(255);

/**
 * Handles a page load that came from clicking a push (`?notification=<id>`,
 * see `pushClickPath`). Queues a mark read of the signed-in person's inbox
 * copy of that notification, and returns a redirect to the same page without
 * the id. The browser keeps any `#comment-…` anchor across the redirect.
 * Returns null for any other page load.
 */
export function pushClickRedirect(
  { request, userId }: { request: Request; userId: number | null },
  executor: DbExecutor = db
): Response | null {
  const url = new URL(request.url);
  if (!url.searchParams.has(PUSH_CLICK_PARAM)) return null;

  const notificationId = notificationIdSchema.safeParse(
    url.searchParams.get(PUSH_CLICK_PARAM)
  );
  url.searchParams.delete(PUSH_CLICK_PARAM);

  if (userId !== null && notificationId.success) {
    enqueueNotificationJob(executor, {
      type: "bulkMarkRead",
      selector: {
        recipientId: String(userId),
        key: "notificationId",
        value: notificationId.data,
      },
    });
    sendNotificationJobsSoon();
  }

  return redirect(`${url.pathname}${url.search}`);
}
