import { describe, expect, it } from "vitest";
import {
  decidePushAsk,
  isIosOutsideInstalledApp,
  isPushOffForEveryEvent,
  type PushAskInput,
} from "./push-ask";

const NOW = new Date("2026-11-14T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

/** A signed-in person on a desktop browser that can do push, never asked. */
function input(overrides: Partial<PushAskInput> = {}): PushAskInput {
  return {
    knockConfigured: true,
    registeredHere: false,
    pushOffForEveryEvent: false,
    browser: {
      iosOutsideInstalledApp: false,
      pushSupported: true,
      permission: "default",
    },
    snoozedUntil: null,
    now: NOW,
    ...overrides,
  };
}

describe("decidePushAsk", () => {
  it("asks normally on a browser that can do push", () => {
    expect(decidePushAsk(input())).toBe("normal");
  });

  it("asks normally when permission is already granted but this browser isn't registered", () => {
    expect(
      decidePushAsk(
        input({
          browser: {
            iosOutsideInstalledApp: false,
            pushSupported: true,
            permission: "granted",
          },
        })
      )
    ).toBe("normal");
  });

  it("shows the Add to Home Screen version on iPhone or iPad outside an installed app", () => {
    expect(
      decidePushAsk(
        input({
          browser: {
            iosOutsideInstalledApp: true,
            pushSupported: false,
            permission: "default",
          },
        })
      )
    ).toBe("add-to-home-screen");
  });

  it("asks normally in the installed Home Screen app", () => {
    expect(
      decidePushAsk(
        input({
          browser: {
            iosOutsideInstalledApp: false,
            pushSupported: true,
            permission: "default",
          },
        })
      )
    ).toBe("normal");
  });

  it("hides the asks on a browser that can't do push", () => {
    expect(
      decidePushAsk(
        input({
          browser: {
            iosOutsideInstalledApp: false,
            pushSupported: false,
            permission: "default",
          },
        })
      )
    ).toBe("hidden");
  });

  it("hides the asks until the browser has been checked", () => {
    expect(decidePushAsk(input({ browser: null }))).toBe("hidden");
  });

  it("hides the asks without Knock", () => {
    expect(decidePushAsk(input({ knockConfigured: false }))).toBe("hidden");
  });

  it("hides the asks when this browser is already registered for the person", () => {
    expect(decidePushAsk(input({ registeredHere: true }))).toBe("hidden");
  });

  it("hides the asks when the person turned push off for every event", () => {
    expect(decidePushAsk(input({ pushOffForEveryEvent: true }))).toBe(
      "hidden"
    );
  });

  it("is blocked for good when the person blocked notifications in this browser", () => {
    expect(
      decidePushAsk(
        input({
          browser: {
            iosOutsideInstalledApp: false,
            pushSupported: true,
            permission: "denied",
          },
          // Long past any snooze.
          snoozedUntil: NOW - 365 * DAY,
        })
      )
    ).toBe("blocked");
  });

  it("is snoozed for the 30 days after the person said not now", () => {
    expect(decidePushAsk(input({ snoozedUntil: NOW + 29 * DAY }))).toBe(
      "snoozed"
    );
  });

  it("snoozes the Add to Home Screen version too", () => {
    expect(
      decidePushAsk(
        input({
          browser: {
            iosOutsideInstalledApp: true,
            pushSupported: false,
            permission: "default",
          },
          snoozedUntil: NOW + DAY,
        })
      )
    ).toBe("snoozed");
  });

  it("asks again once the snooze has run out", () => {
    expect(decidePushAsk(input({ snoozedUntil: NOW - 1 }))).toBe("normal");
  });
});

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

describe("isIosOutsideInstalledApp", () => {
  it("is true for Safari on an iPhone", () => {
    expect(
      isIosOutsideInstalledApp({
        userAgent: IPHONE_SAFARI,
        maxTouchPoints: 5,
        standalone: false,
      })
    ).toBe(true);
  });

  it("is true for an iPad, which says it's a Mac but has a touch screen", () => {
    expect(
      isIosOutsideInstalledApp({
        userAgent: IPAD_AS_MAC,
        maxTouchPoints: 5,
        standalone: false,
      })
    ).toBe(true);
  });

  it("is false for Cadence opened from the Home Screen", () => {
    expect(
      isIosOutsideInstalledApp({
        userAgent: IPHONE_SAFARI,
        maxTouchPoints: 5,
        standalone: true,
      })
    ).toBe(false);
  });

  it("is false for a Mac", () => {
    expect(
      isIosOutsideInstalledApp({
        userAgent: IPAD_AS_MAC,
        maxTouchPoints: 0,
        standalone: false,
      })
    ).toBe(false);
  });

  it("is false for Android", () => {
    expect(
      isIosOutsideInstalledApp({
        userAgent: ANDROID_CHROME,
        maxTouchPoints: 5,
        standalone: false,
      })
    ).toBe(false);
  });
});

describe("isPushOffForEveryEvent", () => {
  it("is true when every Push switch is off", () => {
    expect(
      isPushOffForEveryEvent([
        { switches: { push: false } },
        { switches: { push: false, email: true } },
      ])
    ).toBe(true);
  });

  it("is false while any Push switch is on", () => {
    expect(
      isPushOffForEveryEvent([
        { switches: { push: false } },
        { switches: { push: true, email: false } },
      ])
    ).toBe(false);
  });

  it("ignores rows without a Push switch", () => {
    expect(
      isPushOffForEveryEvent([
        { switches: { push: false } },
        { switches: { email: true } },
      ])
    ).toBe(true);
  });
});
