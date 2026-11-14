import { describe, expect, it } from "vitest";
import {
  pushWasTurnedOnHere,
  rememberPushTurnedOnHere,
} from "./push-turned-on-here";
import { pushUpkeepOnLoad } from "./push-upkeep";

/** A stand-in for the browser's local storage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

const registration = {
  token: "ada-laptop",
  lastSeenAt: "2026-11-01T09:00:00.000Z",
};

describe("which people turned on push in this browser", () => {
  it("remembers each person separately", () => {
    const storage = memoryStorage();

    rememberPushTurnedOnHere(1, storage);

    expect(pushWasTurnedOnHere(1, storage)).toBe(true);
    expect(pushWasTurnedOnHere(2, storage)).toBe(false);

    rememberPushTurnedOnHere(2, storage);
    rememberPushTurnedOnHere(1, storage);

    expect(pushWasTurnedOnHere(1, storage)).toBe(true);
    expect(pushWasTurnedOnHere(2, storage)).toBe(true);
  });

  it("starts again from no one when what's stored can't be read", () => {
    const storage = memoryStorage({ "cadence-push-turned-on": "not json" });

    expect(pushWasTurnedOnHere(1, storage)).toBe(false);
    rememberPushTurnedOnHere(1, storage);
    expect(pushWasTurnedOnHere(1, storage)).toBe(true);
  });

  it("remembers no one when the browser has no local storage", () => {
    rememberPushTurnedOnHere(1, null);

    expect(pushWasTurnedOnHere(1, null)).toBe(false);
  });
});

describe("keeping push working on app load", () => {
  it("refreshes the token of a browser registered for the person signed in", () => {
    expect(
      pushUpkeepOnLoad({ registration, permission: "granted", turnedOnHere: true })
    ).toBe("refresh");
  });

  it("registers again, without asking, someone who turned on push here before", () => {
    expect(
      pushUpkeepOnLoad({
        registration: null,
        permission: "granted",
        turnedOnHere: true,
      })
    ).toBe("register-again");
  });

  it("doesn't register someone else on the same browser until they turn push on", () => {
    expect(
      pushUpkeepOnLoad({
        registration: null,
        permission: "granted",
        turnedOnHere: false,
      })
    ).toBe("nothing");
  });

  it.each(["default", "denied", "unsupported"] as const)(
    "does nothing while the browser's permission is %s",
    (permission) => {
      expect(
        pushUpkeepOnLoad({ registration, permission, turnedOnHere: true })
      ).toBe("nothing");
      expect(
        pushUpkeepOnLoad({ registration: null, permission, turnedOnHere: true })
      ).toBe("nothing");
    }
  );
});
