// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { pushAsksSnoozedUntil, snoozePushAsks } from "./push-ask-snooze";

const NOW = new Date("2026-11-14T12:00:00Z").getTime();
const THIRTY_DAYS_LATER = new Date("2026-12-14T12:00:00Z").getTime();

afterEach(() => {
  localStorage.clear();
});

describe("push ask snooze", () => {
  it("isn't snoozed for someone who never said not now", () => {
    expect(pushAsksSnoozedUntil(7)).toBeNull();
  });

  it("snoozes the asks for 30 days", () => {
    snoozePushAsks(7, NOW);

    expect(pushAsksSnoozedUntil(7)).toBe(THIRTY_DAYS_LATER);
  });

  it("snoozes only the person who said not now", () => {
    snoozePushAsks(7, NOW);

    expect(pushAsksSnoozedUntil(8)).toBeNull();
  });

  it("ignores a stored value that isn't a time", () => {
    snoozePushAsks(7, NOW);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) localStorage.setItem(key, "soon");
    }

    expect(pushAsksSnoozedUntil(7)).toBeNull();
  });
});
