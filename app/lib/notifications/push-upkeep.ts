// The rules that keep browser push working on each app load, without anyone
// thinking about it. The browser runs them (use-push-upkeep.ts); the server
// side is app/lib/push-registrations.server.ts.

/** This browser's registration for the person signed in, from the server. */
export type BrowserPushRegistration = {
  token: string;
  /** When the browser last registered or refreshed its token (ISO). */
  lastSeenAt: string;
};

/** What the browser does about push when the app loads for someone. */
export type PushUpkeep = "refresh" | "register-again" | "nothing";

/**
 * Only while the browser still lets Cadence notify: a browser registered for
 * the person signed in refreshes its token, and one where that person turned
 * on push before (`turnedOnHere`, from local storage) registers again
 * without asking. Anyone else isn't registered until they turn push on.
 */
export function pushUpkeepOnLoad({
  registration,
  permission,
  turnedOnHere,
}: {
  registration: BrowserPushRegistration | null;
  permission: NotificationPermission | "unsupported";
  turnedOnHere: boolean;
}): PushUpkeep {
  if (permission !== "granted") return "nothing";
  if (registration) return "refresh";
  return turnedOnHere ? "register-again" : "nothing";
}

/** How often an unchanged token is sent again, so the browser counts as seen. */
const RESEND_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the token Firebase just gave this browser needs sending to the
 * server: it changed, or the browser was last seen more than a day ago.
 */
export function pushTokenNeedsSending({
  registration,
  token,
  now,
}: {
  registration: BrowserPushRegistration;
  token: string;
  now: Date;
}) {
  if (token !== registration.token) return true;
  return now.getTime() - new Date(registration.lastSeenAt).getTime() > RESEND_AFTER_MS;
}
