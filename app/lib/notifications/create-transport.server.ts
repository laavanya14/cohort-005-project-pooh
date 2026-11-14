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

  return createKnockTransport({
    secretKey: knock.secretKey,
    inAppChannelId: knock.inAppChannelId,
    fcmChannelId: knock.fcmChannelId,
  });
}

// Kept on globalThis so a dev-server reload reuses it.
const transportGlobal = globalThis as typeof globalThis & {
  __cadenceNotificationTransport?: NotificationTransport;
};

/**
 * The server process's one Knock-facing interface, for the outbox and for
 * routes that read or write Knock straight away (notification preferences).
 * Domain functions take a transport as an argument instead, so tests can
 * hand in the recording fake.
 */
export function getNotificationTransport(): NotificationTransport {
  transportGlobal.__cadenceNotificationTransport ??=
    createNotificationTransport();
  return transportGlobal.__cadenceNotificationTransport;
}
