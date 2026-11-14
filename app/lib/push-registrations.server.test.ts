import { describe, expect, it } from "vitest";
import { users, UserRole } from "~/db/schema";
import { sendNotificationJobs } from "~/lib/notifications/outbox.server";
import { pushTokenNeedsSending } from "~/lib/notifications/push-upkeep";
import { createRecordingTransport } from "~/test/recording-transport";
import { testDb } from "~/test/test-db";
import {
  browserLabelFor,
  isRegisteredForPush,
  prunePushRegistrations,
  pushRegistrationHere,
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

describe("refreshing this browser's registration on app load", () => {
  const registeredAt = new Date("2026-10-01T09:00:00.000Z");
  const hoursLater = (hours: number) =>
    new Date(registeredAt.getTime() + hours * 60 * 60 * 1000);

  /**
   * One app load: the browser asks Firebase for its token again (`token`)
   * and sends it only if the refresh rule says so. Returns whether it sent.
   */
  function appLoad(
    userId: number,
    registrationId: number,
    { token, now }: { token: string; now: Date }
  ) {
    const registration = pushRegistrationHere({ userId, registrationId });
    if (!registration) throw new Error("This browser isn't registered.");
    if (!pushTokenNeedsSending({ registration, token, now })) return false;
    register(userId, { token, registrationId, now });
    return true;
  }

  it("sends nothing when the token is the same and the browser was seen within a day", async () => {
    const ada = seedPerson();
    const laptop = register(ada.id, { token: "ada-laptop", now: registeredAt });
    await knockAfterSending();

    const sent = appLoad(ada.id, laptop, {
      token: "ada-laptop",
      now: hoursLater(23),
    });

    expect(sent).toBe(false);
    expect((await knockAfterSending()).calls).toEqual([]);
  });

  it("sends the same token again once a day, so the browser counts as seen", () => {
    const ada = seedPerson();
    const laptop = register(ada.id, { token: "ada-laptop", now: registeredAt });

    expect(appLoad(ada.id, laptop, { token: "ada-laptop", now: hoursLater(25) })).toBe(
      true
    );
    expect(appLoad(ada.id, laptop, { token: "ada-laptop", now: hoursLater(30) })).toBe(
      false
    );
    expect(pushRegistrationHere({ userId: ada.id, registrationId: laptop })).toEqual({
      token: "ada-laptop",
      lastSeenAt: hoursLater(25).toISOString(),
    });
  });

  it("sends a token Firebase changed straight away, replacing the old one in Knock", async () => {
    const ada = seedPerson();
    const laptop = register(ada.id, { token: "old-token", now: registeredAt });
    await knockAfterSending();

    const sent = appLoad(ada.id, laptop, { token: "new-token", now: hoursLater(1) });

    expect(sent).toBe(true);
    const knock = await knockAfterSending();
    expect(knock.pushTokens.get(String(ada.id))).toEqual(["new-token"]);
  });

  it("finds no registration for a browser registered to someone else", () => {
    const ada = seedPerson("Ada");
    const grace = seedPerson("Grace");
    const adasLaptop = register(ada.id, { token: "ada-laptop" });

    expect(
      pushRegistrationHere({ userId: grace.id, registrationId: adasLaptop })
    ).toBeNull();
    expect(
      pushRegistrationHere({ userId: grace.id, registrationId: null })
    ).toBeNull();
  });
});

describe("pruning browsers not seen for 30 days", () => {
  const registeredAt = new Date("2026-10-01T09:00:00.000Z");
  const daysLater = (days: number) =>
    new Date(registeredAt.getTime() + days * 24 * 60 * 60 * 1000);

  it("drops a browser not seen for 30 days and writes the person's list without it", async () => {
    const ada = seedPerson();
    register(ada.id, { token: "ada-old-laptop", now: registeredAt });
    register(ada.id, { token: "ada-phone", now: daysLater(29) });
    await knockAfterSending();

    prunePushRegistrations({ now: daysLater(30.5) });

    const knock = await knockAfterSending();
    expect(knock.calls).toEqual([
      { method: "setPushTokens", userId: String(ada.id), tokens: ["ada-phone"] },
    ]);
  });

  it("keeps a browser seen within the last 30 days, writing nothing", async () => {
    const ada = seedPerson();
    const laptop = register(ada.id, { token: "ada-laptop", now: registeredAt });
    await knockAfterSending();

    prunePushRegistrations({ now: daysLater(29.9) });

    const knock = await knockAfterSending();
    expect(knock.calls).toEqual([]);
    expect(isRegisteredForPush({ userId: ada.id, registrationId: laptop })).toBe(
      true
    );
  });

  it("counts from when the browser was last seen, not when it was registered", async () => {
    const ada = seedPerson();
    const laptop = register(ada.id, { token: "ada-laptop", now: registeredAt });
    register(ada.id, {
      token: "ada-laptop",
      registrationId: laptop,
      now: daysLater(20),
    });
    await knockAfterSending();

    prunePushRegistrations({ now: daysLater(40) });

    expect(isRegisteredForPush({ userId: ada.id, registrationId: laptop })).toBe(
      true
    );
  });

  it("unsets the list of someone whose every browser went quiet", async () => {
    const ada = seedPerson("Ada");
    const grace = seedPerson("Grace");
    register(ada.id, { token: "ada-laptop", now: registeredAt });
    register(grace.id, { token: "grace-laptop", now: registeredAt });
    await knockAfterSending();

    prunePushRegistrations({ now: daysLater(31) });

    const knock = await knockAfterSending();
    expect(knock.calls).toEqual([
      { method: "setPushTokens", userId: String(ada.id), tokens: [] },
      { method: "setPushTokens", userId: String(grace.id), tokens: [] },
    ]);
  });
});
