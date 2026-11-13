import { createFileTransport } from "./file-transport.server";
import type { NotificationTransport } from "./transport";

/**
 * The Knock-facing interface the server process uses. Without
 * KNOCK_SECRET_KEY, notifications are written to .outbox/notifications/.
 */
export function createNotificationTransport(
  env: NodeJS.ProcessEnv = process.env
): NotificationTransport {
  if (!env.KNOCK_SECRET_KEY) return createFileTransport();

  // The real Knock adapter is the next piece of work. Until then, a key that
  // is set must not quietly fall back to the fake.
  throw new Error(
    "KNOCK_SECRET_KEY is set, but Cadence can't send to Knock yet. Unset it " +
      "to write notifications to .outbox/notifications/ instead."
  );
}
