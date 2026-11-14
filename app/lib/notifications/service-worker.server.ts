import { SDK_VERSION } from "firebase/app";
import type { FirebaseWebConfig } from "./firebase-config";

// Cadence's own service worker, served at /sw.js by app/routes/sw.ts.
// Cadence registers it and hands it to Firebase, which uses it to receive
// browser push and show each notification. Later features (the manifest,
// Home Screen install) share it.
//
// There is deliberately no `notificationclick` handler: Firebase focuses a
// tab already on the push's link, or opens one.

/**
 * The installed firebase package's version, which package.json pins
 * exactly. The worker loads Firebase's compat scripts of this same version.
 */
export const FIREBASE_VERSION = SDK_VERSION;

/**
 * The worker's source. With no Firebase config (Knock isn't configured),
 * it's an empty worker that loads nothing.
 */
export function serviceWorkerScript({
  firebaseConfig,
  firebaseVersion,
}: {
  firebaseConfig: FirebaseWebConfig | null;
  firebaseVersion: string;
}) {
  if (!firebaseConfig) {
    return "// Cadence's service worker. Browser push is off: Knock isn't configured.\n";
  }

  const scripts = ["app", "messaging"].map(
    (product) =>
      `importScripts(${JSON.stringify(
        `https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-${product}-compat.js`
      )});`
  );

  return [
    "// Cadence's service worker: receives browser push through Firebase.",
    ...scripts,
    `firebase.initializeApp(${JSON.stringify(firebaseConfig)});`,
    // Shows each push sent while no Cadence tab is in front.
    "firebase.messaging();",
    "",
  ].join("\n");
}
