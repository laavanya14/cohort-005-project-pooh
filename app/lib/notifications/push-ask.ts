// Which push ask Cadence shows: the Inbox card and the ask right after a
// student raises a refund request or posts a comment or reply. Pure, so it's
// tested on its own (push-ask.test.ts). `PushAsksProvider`
// (app/components/push-asks-provider.tsx) gathers the inputs in the browser.

import type { NotificationChannelType } from "./transport";

/** What this browser is, checked once it has hydrated. */
export type PushAskBrowser = {
  /** An iPhone or iPad, outside Cadence opened from the Home Screen. */
  iosOutsideInstalledApp: boolean;
  /**
   * `PushManager` and `Notification` exist, and Firebase's `isSupported()`
   * is true.
   */
  pushSupported: boolean;
  /** The browser's notification permission. */
  permission: NotificationPermission;
};

export type PushAskInput = {
  knockConfigured: boolean;
  /** This browser is registered for push for the person signed in. */
  registeredHere: boolean;
  /** The person turned Push off for every event in their preferences. */
  pushOffForEveryEvent: boolean;
  /** Null until checked in the browser. */
  browser: PushAskBrowser | null;
  /** When the person's "Not now" runs out, in ms, or null if never snoozed. */
  snoozedUntil: number | null;
  now: number;
};

/**
 * - `normal`: "Turn on" / "Notify me".
 * - `add-to-home-screen`: "Show me how", on iPhone and iPad in the browser.
 * - `hidden`: nothing to ask, or this browser can't do push.
 * - `snoozed`: the person said "Not now" in the last 30 days.
 * - `blocked`: the person blocked notifications for Cadence here.
 */
export type PushAsk =
  | "normal"
  | "add-to-home-screen"
  | "hidden"
  | "snoozed"
  | "blocked";

/** What a student just did that Cadence asks about push after. */
export type PushAskMoment = "refund-request" | "comment" | "reply";

/**
 * The search parameter the refund request action redirects with, so the
 * page it lands on asks about push.
 */
export const REFUND_REQUEST_SENT_PARAM = "refund-request";
export const REFUND_REQUEST_SENT_VALUE = "sent";

/** Whether an ask is on screen in this state. */
export function isPushAskShown(ask: PushAsk) {
  return ask === "normal" || ask === "add-to-home-screen";
}

export function decidePushAsk({
  knockConfigured,
  registeredHere,
  pushOffForEveryEvent,
  browser,
  snoozedUntil,
  now,
}: PushAskInput): PushAsk {
  if (!knockConfigured || registeredHere || pushOffForEveryEvent || !browser) {
    return "hidden";
  }
  const snoozed = snoozedUntil !== null && snoozedUntil > now;

  if (browser.iosOutsideInstalledApp) {
    return snoozed ? "snoozed" : "add-to-home-screen";
  }
  if (!browser.pushSupported) return "hidden";
  if (browser.permission === "denied") return "blocked";
  if (snoozed) return "snoozed";
  return "normal";
}

/** What `isIosOutsideInstalledApp` reads from the browser. */
export type DeviceHints = {
  userAgent: string;
  maxTouchPoints: number;
  /**
   * Cadence was opened from the Home Screen: `navigator.standalone`, or the
   * `(display-mode: standalone)` media query.
   */
  standalone: boolean;
};

/**
 * An iPhone or iPad outside Cadence opened from the Home Screen, where iOS
 * gives web pages no push at all. iPadOS says it's a Mac, so a "Mac" with a
 * touch screen counts as an iPad.
 */
export function isIosOutsideInstalledApp({
  userAgent,
  maxTouchPoints,
  standalone,
}: DeviceHints) {
  if (standalone) return false;
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** The device hints of the browser this runs in. Browser only. */
export function currentDeviceHints(): DeviceHints {
  const standalone =
    ("standalone" in navigator && navigator.standalone === true) ||
    window.matchMedia?.("(display-mode: standalone)").matches === true;
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone,
  };
}

/**
 * Whether the person turned Push off for every event in Settings →
 * Notifications. Rows without a Push switch don't count.
 */
export function isPushOffForEveryEvent(
  rows: readonly {
    switches: Partial<Record<NotificationChannelType, boolean>>;
  }[]
) {
  return rows.every((row) => row.switches.push !== true);
}
