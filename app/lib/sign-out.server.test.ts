import { describe, expect, it } from "vitest";
import { users, UserRole } from "~/db/schema";
import { sendNotificationJobs } from "~/lib/notifications/outbox.server";
import { savePushRegistration } from "~/lib/push-registrations.server";
import {
  getCurrentUserId,
  getPushRegistrationId,
  getSession,
  sessionStorage,
  PUSH_REGISTRATION_SESSION_KEY,
} from "~/lib/session";
import { createRecordingTransport } from "~/test/recording-transport";
import { testDb } from "~/test/test-db";
import { signOut, switchUser } from "./sign-out.server";

function seedPerson(name: string) {
  return testDb()
    .insert(users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

/** A request from a browser whose session is signed in as the person. */
async function browserSignedInAs(
  userId: number,
  pushRegistrationId: number | null = null
) {
  const session = await getSession(new Request("http://localhost/"));
  session.set("userId", userId);
  if (pushRegistrationId !== null) {
    session.set(PUSH_REGISTRATION_SESSION_KEY, pushRegistrationId);
  }
  return requestWithCookie(await sessionStorage.commitSession(session));
}

/** The next request from the browser that got `setCookie`. */
function requestWithCookie(setCookie: string) {
  const [cookie] = setCookie.split(";");
  return new Request("http://localhost/", { headers: { Cookie: cookie } });
}

/** Ada turned on push on her laptop and her phone. */
async function adaWithTwoBrowsers() {
  const ada = seedPerson("Ada");
  const laptop = savePushRegistration({
    userId: ada.id,
    token: "ada-laptop",
    userAgent: null,
    registrationId: null,
  });
  savePushRegistration({
    userId: ada.id,
    token: "ada-phone",
    userAgent: null,
    registrationId: null,
  });
  await sendNotificationJobs({ transport: createRecordingTransport() });
  return { ada, laptop };
}

async function knockAfterSending() {
  const knock = createRecordingTransport();
  await sendNotificationJobs({ transport: knock });
  return knock;
}

describe("signing out", () => {
  it("stops push to this browser only, even if its JavaScript never runs", async () => {
    const { ada, laptop } = await adaWithTwoBrowsers();

    await signOut(await browserSignedInAs(ada.id, laptop));

    const knock = await knockAfterSending();
    expect(knock.pushTokens.get(String(ada.id))).toEqual(["ada-phone"]);
  });

  it("changes nothing in Knock for a browser that never turned push on", async () => {
    const { ada } = await adaWithTwoBrowsers();

    await signOut(await browserSignedInAs(ada.id));

    const knock = await knockAfterSending();
    expect(knock.calls).toEqual([]);
  });
});

describe("switching users in the DevUI", () => {
  it("stops push to this browser for the person switched away from", async () => {
    const { ada, laptop } = await adaWithTwoBrowsers();
    const grace = seedPerson("Grace");

    const cookie = await switchUser(
      await browserSignedInAs(ada.id, laptop),
      grace.id
    );

    const knock = await knockAfterSending();
    expect(knock.pushTokens.get(String(ada.id))).toEqual(["ada-phone"]);
    const next = requestWithCookie(cookie);
    expect(await getCurrentUserId(next)).toBe(grace.id);
    expect(await getPushRegistrationId(next)).toBeNull();
  });

  it("keeps push to this browser when switching to the person already signed in", async () => {
    const { ada, laptop } = await adaWithTwoBrowsers();

    const cookie = await switchUser(
      await browserSignedInAs(ada.id, laptop),
      ada.id
    );

    const knock = await knockAfterSending();
    expect(knock.calls).toEqual([]);
    expect(await getPushRegistrationId(requestWithCookie(cookie))).toBe(laptop);
  });
});
