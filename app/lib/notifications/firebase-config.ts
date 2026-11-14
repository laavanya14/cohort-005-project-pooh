// The Firebase web app config for browser push, built from the public
// notification config (see config.server.ts). Shared by the browser, which
// asks Firebase for a token, and /sw.js, which receives the pushes.

/** The Firebase web app options browser push needs. None are secret. */
export type FirebaseWebConfig = {
  apiKey: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
};

/** What the browser needs to turn on push: the app config and VAPID key. */
export type BrowserPushConfig = {
  firebase: FirebaseWebConfig;
  vapidKey: string;
};

/** The public Knock settings that hold the Firebase config. */
type PublicFirebaseSettings = {
  firebaseApiKey: string;
  firebaseProjectId: string;
  firebaseMessagingSenderId: string;
  firebaseAppId: string;
  firebaseVapidKey: string;
};

/** Browser push config, or null when Knock (and so push) isn't configured. */
export function browserPushConfig(
  knock: PublicFirebaseSettings | null
): BrowserPushConfig | null {
  if (!knock) return null;

  return {
    firebase: {
      apiKey: knock.firebaseApiKey,
      projectId: knock.firebaseProjectId,
      messagingSenderId: knock.firebaseMessagingSenderId,
      appId: knock.firebaseAppId,
    },
    vapidKey: knock.firebaseVapidKey,
  };
}
