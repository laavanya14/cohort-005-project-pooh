import { readNotificationConfig } from "~/lib/notifications/config.server";
import { browserPushConfig } from "~/lib/notifications/firebase-config";
import {
  FIREBASE_VERSION,
  serviceWorkerScript,
} from "~/lib/notifications/service-worker.server";

// GET /sw.js: Cadence's service worker, with this environment's Firebase
// config written in. A resource route, so there must never be a public/sw.js
// (static files would win in production).

export function loader() {
  const { knock } = readNotificationConfig();
  const script = serviceWorkerScript({
    firebaseConfig: browserPushConfig(knock)?.firebase ?? null,
    firebaseVersion: FIREBASE_VERSION,
  });

  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // The browser checks for a new worker on every registration.
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    },
  });
}
