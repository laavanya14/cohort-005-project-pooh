import { describe, expect, it } from "vitest";
import { users, UserRole } from "~/db/schema";
import { sendNotificationJobs } from "~/lib/notifications/outbox.server";
import { createRecordingTransport } from "~/test/recording-transport";
import { testDb } from "~/test/test-db";
import {
  browserLabelFor,
  isRegisteredForPush,
  removePushRegistration,
  savePushRegistration,
} from "./push-registrations.server";

const CHROME_ON_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function seedPerson(name = "Ada") {
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

/** A browser turning on push for a person, with overrides. */
function register(
  userId: number,
  overrides: Partial<Parameters<typeof savePushRegistration>[0]> = {}
) {
  return savePushRegistration({
    userId,
    token: "token-1",
    userAgent: CHROME_ON_MAC,
    registrationId: null,
    ...overrides,
  });
}

/** Sends the outbox and returns the token lists Knock now holds. */
async function knockAfterSending() {
  const knock = createRecordingTransport();
  await sendNotificationJobs({ transport: knock });
  return knock;
}

describe("registering a browser for push", () => {
  it("writes the person's token to Knock", async () => {
    const ada = seedPerson();

    register(ada.id, { token: "ada-chrome" });

    const knock = await knockAfterSending();
    expect(knock.pushTokens.get(String(ada.id))).toEqual(["ada-chrome"]);
  });

  it("keeps both browsers when one person registers a second", async () => {
    const ada = seedPerson();

    register(ada.id, { token: "ada-laptop" });
    register(ada.id, { token: "ada-phone" });

    const knock = await knockAfterSending();
    expect(knock.pushTokens.get(String(ada.id))).toEqual([
      "ada-laptop",
      "ada-phone",
    ]);
  });

  it("combines the syncs per person into one write of the whole list", async () => {
    const ada = seedPerson("Ada");
    const grace = seedPerson("Grace");

    register(ada.id, { token: "ada-laptop" });
    register(grace.id, { token: "grace-laptop" });
    register(ada.id, { token: "ada-phone" });

    const knock = await knockAfterSending();
    expect(knock.calls).toEqual([
      {
        method: "setPushTokens",
        userId: String(ada.id),
        tokens: ["ada-laptop", "ada-phone"],
      },
      {
        method: "setPushTokens",
        userId: String(grace.id),
        tokens: ["grace-laptop"],
      },
    ]);
  });

  it("replaces this browser's old token when Firebase gives it a new one", async () => {
    const ada = seedPerson();
    const registrationId = register(ada.id, { token: "old-token" });

    const sameRegistration = register(ada.id, {
      token: "new-token",
      registrationId,
    });

    expect(sameRegistration).toBe(registrationId);
    const knock = await knockAfterSending();
    expect(knock.pushTokens.get(String(ada.id))).toEqual(["new-token"]);
  });

  it("moves a shared browser to the person who turned push on in it", async () => {
    const ada = seedPerson("Ada");
    const grace = seedPerson("Grace");
    register(ada.id, { token: "shared-browser" });
    await knockAfterSending();

    register(grace.id, { token: "shared-browser" });

    const knock = await knockAfterSending();
    expect(knock.calls).toContainEqual({
      method: "setPushTokens",
      userId: String(ada.id),
      tokens: [],
    });
    expect(knock.pushTokens.get(String(grace.id))).toEqual(["shared-browser"]);
  });

  it("writes the whole list again after Knock was down", async () => {
    const ada = seedPerson();
    register(ada.id, { token: "ada-laptop" });
    const knock = createRecordingTransport();
    knock.failNext();
    await sendNotificationJobs({ transport: knock });

    register(ada.id, { token: "ada-phone" });
    await sendNotificationJobs({
      transport: knock,
      now: new Date(Date.now() + 2 * 60 * 1000),
    });

    expect(knock.calls).toEqual([
      {
        method: "setPushTokens",
        userId: String(ada.id),
        tokens: ["ada-laptop", "ada-phone"],
      },
    ]);
  });

  it("labels the browser it was registered from", () => {
    expect(browserLabelFor(CHROME_ON_MAC)).toBe("Chrome on macOS");
    expect(
      browserLabelFor(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
      )
    ).toBe("Safari on iOS");
    expect(browserLabelFor(null)).toBe("A browser");
  });
});

describe("removing a browser's registration", () => {
  it("stops push to that browser only, keeping the person's others", async () => {
    const ada = seedPerson();
    const laptop = register(ada.id, { token: "ada-laptop" });
    register(ada.id, { token: "ada-phone" });
    await knockAfterSending();

    removePushRegistration({ userId: ada.id, registrationId: laptop });

    const knock = await knockAfterSending();
    expect(knock.pushTokens.get(String(ada.id))).toEqual(["ada-phone"]);
  });

  it("unsets the person's list in Knock when it was their last browser", async () => {
    const ada = seedPerson();
    const laptop = register(ada.id, { token: "ada-laptop" });
    await knockAfterSending();

    removePushRegistration({ userId: ada.id, registrationId: laptop });

    const knock = await knockAfterSending();
    expect(knock.calls).toEqual([
      { method: "setPushTokens", userId: String(ada.id), tokens: [] },
    ]);
  });

  it("leaves someone else's registration alone", async () => {
    const ada = seedPerson("Ada");
    const grace = seedPerson("Grace");
    const gracesLaptop = register(grace.id, { token: "grace-laptop" });
    await knockAfterSending();

    removePushRegistration({ userId: ada.id, registrationId: gracesLaptop });

    const knock = await knockAfterSending();
    expect(knock.calls).toEqual([]);
    expect(
      isRegisteredForPush({ userId: grace.id, registrationId: gracesLaptop })
    ).toBe(true);
  });
});
