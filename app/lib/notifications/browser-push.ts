import type { BrowserPushConfig } from "./firebase-config";

// Browser push in this browser, from the browser's side. Firebase is loaded
// only when one of these runs (they're called from taps and effects), so it
// never reaches the server bundle. The server side is
// app/routes/api.push-registration.ts and app/lib/push-registrations.server.ts.
//
// Later asks (the Inbox card, the ask after raising a refund request or
// posting a comment) call `registerBrowserForPush` too, through
// `useBrowserPush` (app/lib/notifications/use-browser-push.ts).

/** Cadence's service worker (app/routes/sw.ts), which Firebase receives pushes in. */
export const SERVICE_WORKER_PATH = "/sw.js";

/** Where the browser sends its token (app/routes/api.push-registration.ts). */
export const PUSH_REGISTRATION_PATH = "/api/push-registration";

/**
 * Whether this browser lets Cadence push: the browser's notification
 * permission, or `unsupported` when it has no push at all.
 */
export type BrowserPushPermission = NotificationPermission | "unsupported";

/** The permission right now. Only call it in the browser (effects, handlers). */
export function browserPushPermission(): BrowserPushPermission {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("PushManager" in window) ||
    !("serviceWorker" in navigator)
  ) {
    return "unsupported";
  }
  return Notification.permission;
}

/** What the Settings row says about push in this browser. */
export type BrowserPushStatus = "on" | "blocked" | "off" | "unsupported";

/**
 * Push is on when the server has this browser registered for the person
 * signed in (`registeredHere`, from the session) and the browser still lets
 * Cadence notify. `permission` is null until the browser has been checked,
 * so the server's answer shows first.
 */
export function browserPushStatus({
  registeredHere,
  permission,
}: {
  registeredHere: boolean;
  permission: BrowserPushPermission | null;
}): BrowserPushStatus {
  if (permission === "unsupported") return "unsupported";
  if (permission === "denied") return "blocked";
  if (permission === null) return registeredHere ? "on" : "off";
  return registeredHere && permission === "granted" ? "on" : "off";
}

/** Whether this browser can get push through Firebase. */
export async function canUseBrowserPush() {
  if (browserPushPermission() === "unsupported") return false;
  const { isSupported } = await import("firebase/messaging");
  return isSupported();
}

/** What turning on push in this browser came to. */
export type RegisterForPushResult =
  | { outcome: "registered"; registrationId: number }
  /** The person blocked notifications for Cadence in this browser. */
  | { outcome: "blocked" }
  /** The person closed the browser's prompt without choosing. */
  | { outcome: "dismissed" }
  | { outcome: "unsupported" };

async function firebaseMessaging(config: BrowserPushConfig) {
  const { getApp, getApps, initializeApp } = await import("firebase/app");
  const { getMessaging } = await import("firebase/messaging");
  const app = getApps().length > 0 ? getApp() : initializeApp(config.firebase);
  return getMessaging(app);
}

/**
 * Turns on push in this browser for the person signed in. Call it from a
 * tap: if the browser hasn't been asked yet, it shows the browser's prompt.
 * It registers Cadence's service worker, asks Firebase for this browser's
 * token (`getToken`), and sends it to Cadence's server, which stores it and
 * keeps the registration's id in the session. Rejects when Firebase or
 * Cadence's server fails.
 */
export async function registerBrowserForPush(
  config: BrowserPushConfig
): Promise<RegisterForPushResult> {
  if (!(await canUseBrowserPush())) return { outcome: "unsupported" };

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission === "denied") return { outcome: "blocked" };
  if (permission === "default") return { outcome: "dismissed" };

  const serviceWorkerRegistration = await navigator.serviceWorker.register(
    SERVICE_WORKER_PATH,
    { scope: "/" }
  );
  const { getToken } = await import("firebase/messaging");
  const token = await getToken(await firebaseMessaging(config), {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration,
  });

  const response = await fetch(PUSH_REGISTRATION_PATH, {
    method: "POST",
    body: new URLSearchParams({ token }),
  });
  if (!response.ok) {
    throw new Error(`Cadence answered ${response.status} to the push token.`);
  }
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== "object" ||
    !("registrationId" in body) ||
    typeof body.registrationId !== "number"
  ) {
    throw new Error("Cadence didn't return a push registration id.");
  }

  return { outcome: "registered", registrationId: body.registrationId };
}

/**
 * Asks Firebase to delete this browser's token, when someone signs out or
 * is switched away from. Cadence's server already removes the registration
 * from the session, so this is a best effort: it never rejects.
 */
export async function forgetBrowserPushToken(config: BrowserPushConfig) {
  try {
    if (browserPushPermission() !== "granted") return;
    if (!(await canUseBrowserPush())) return;
    const serviceWorkerRegistration =
      await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
    if (!serviceWorkerRegistration) return;

    const { deleteToken } = await import("firebase/messaging");
    // deleteToken has no option for the service worker, and without one it
    // registers Firebase's default /firebase-messaging-sw.js, which Cadence
    // doesn't have. getToken stores the one it's given here, so do the same.
    const messaging = Object.assign(await firebaseMessaging(config), {
      swRegistration: serviceWorkerRegistration,
    });
    await deleteToken(messaging);
  } catch (error) {
    console.warn("[notifications] Couldn't delete the push token:", error);
  }
}
