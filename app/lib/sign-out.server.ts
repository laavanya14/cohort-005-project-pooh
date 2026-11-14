import type { Session } from "react-router";
import { removePushRegistration } from "~/lib/push-registrations.server";
import {
  getSession,
  PUSH_REGISTRATION_SESSION_KEY,
  pushRegistrationIdOf,
  sessionStorage,
  userIdOf,
} from "~/lib/session";

// Leaving a browser: signing out, or the DevUI switching to someone else.
// Either way, push to this browser stops for the person leaving it, on the
// server, even if the browser's JavaScript never runs (docs/adr/0014).

/**
 * Removes the push registration the session holds for the person signed in,
 * and forgets it. Reads both before the session is destroyed or changed.
 */
function stopPushToThisBrowser(session: Session) {
  const userId = userIdOf(session);
  const registrationId = pushRegistrationIdOf(session);

  if (userId !== null && registrationId !== null) {
    removePushRegistration({ userId, registrationId });
  }
  session.unset(PUSH_REGISTRATION_SESSION_KEY);
}

/** Signs the browser out. Returns the Set-Cookie value that ends the session. */
export async function signOut(request: Request) {
  const session = await getSession(request);
  stopPushToThisBrowser(session);
  return sessionStorage.destroySession(session);
}

/**
 * Signs the browser in as someone else (the DevUI). Push to this browser
 * stops for the person switched away from; switching to the person already
 * signed in changes nothing. Returns the Set-Cookie value.
 */
export async function switchUser(request: Request, userId: number) {
  const session = await getSession(request);
  if (userIdOf(session) !== userId) {
    stopPushToThisBrowser(session);
    session.set("userId", userId);
  }
  return sessionStorage.commitSession(session);
}
