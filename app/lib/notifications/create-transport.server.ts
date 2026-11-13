import { readNotificationConfig } from "./config.server";
import { createFileTransport } from "./file-transport.server";
import { createKnockTransport } from "./knock-transport.server";
import type { NotificationTransport } from "./transport";

/**
 * The Knock-facing interface the server process uses. With KNOCK_SECRET_KEY
 * set it sends to Knock, and throws if anything else Knock needs is missing.
 * Without it, notifications are written to .outbox/notifications/.
 */
export function createNotificationTransport(
  env: Record<string, string | undefined> = process.env
): NotificationTransport {
  const { knock } = readNotificationConfig(env);
  if (!knock) return createFileTransport();

  return createKnockTransport({ secretKey: knock.secretKey });
}
