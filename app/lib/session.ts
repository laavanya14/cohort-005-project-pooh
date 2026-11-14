import { createCookieSessionStorage, type Session } from "react-router";

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "cadence_session",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secrets: ["cadence-dev-secret"],
  },
});

/**
 * The session key holding the id of this browser's push registration, set
 * when the person signed in turns on push here. Signing out and DevUI
 * switching read it to stop push to this browser (docs/adr/0014).
 */
export const PUSH_REGISTRATION_SESSION_KEY = "pushRegistrationId";

export async function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

/** The person the session is signed in as. */
export function userIdOf(session: Session): number | null {
  const userId = session.get("userId");
  return typeof userId === "number" ? userId : null;
}

/** The id of this browser's push registration, if push is on here. */
export function pushRegistrationIdOf(session: Session): number | null {
  const id = session.get(PUSH_REGISTRATION_SESSION_KEY);
  return typeof id === "number" ? id : null;
}

export async function getCurrentUserId(request: Request): Promise<number | null> {
  return userIdOf(await getSession(request));
}

export async function setCurrentUserId(request: Request, userId: number) {
  const session = await getSession(request);
  session.set("userId", userId);
  return sessionStorage.commitSession(session);
}

export async function getPushRegistrationId(
  request: Request
): Promise<number | null> {
  return pushRegistrationIdOf(await getSession(request));
}

export async function setPushRegistrationId(
  request: Request,
  registrationId: number
) {
  const session = await getSession(request);
  session.set(PUSH_REGISTRATION_SESSION_KEY, registrationId);
  return sessionStorage.commitSession(session);
}

export async function getDevCountry(request: Request): Promise<string | null> {
  const session = await getSession(request);
  const country = session.get("devCountry");
  return typeof country === "string" ? country : null;
}

export async function setDevCountry(request: Request, country: string | null) {
  const session = await getSession(request);
  if (country) {
    session.set("devCountry", country);
  } else {
    session.unset("devCountry");
  }
  return sessionStorage.commitSession(session);
}
