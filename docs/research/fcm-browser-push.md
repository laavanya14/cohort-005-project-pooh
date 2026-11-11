# Browser push through Knock's FCM channel: what Cadence has to wire up

Research for issue #20. Background: ADR 0013, `docs/adr/0013-knock-for-notifications-with-fcm-for-browser-push.md` (in the main checkout; not yet on `main`), chose Knock for notifications and sends browser push through Knock's Firebase Cloud Messaging (FCM) channel.

This note records facts, not decisions. It was checked against primary sources on 2026-11-11. Every claim cites its source, and anything inferred rather than stated says so. Repo facts were taken from the code at `origin/main` (88cd9b9).

## Summary

- **Who holds which secret.** The Firebase service account JSON goes into the Knock dashboard. Cadence never holds it. Cadence ships only non-secret values to the browser: the Firebase web config, the VAPID public key, and possibly a Knock public key. The secret Knock API key stays on the server.
- **Serving the service worker.** Put `public/firebase-messaging-sw.js` in `public/`. The file is then served at `/firebase-messaging-sw.js` in both `react-router dev` and `react-router-serve`, with no build changes. Vite copies it as-is, though, so it cannot use `import.meta.env` or ES imports. The Firebase docs offer two ways around that: the compat build loaded with `importScripts`, or bundling the worker.
- **Getting the browser onto the Knock user.** Knock stores `{ tokens: [...] }` per user per channel. Each `set` call replaces what is already there. Knock's docs say to send the browser's token to Cadence's server, which then calls `users.setChannelData`.
- **Surprise: FCM is dropping registration tokens.** Firebase JS SDK 12.14.0 (May 2026) added `register()`, `onRegistered()` and `unregister()`, which work with Firebase Installation IDs (FIDs), and marked `getToken()` obsolete. Knock's docs still mention only tokens.
- **What Knock sends.** Knock always sends `data` (trigger data, flattened, every value a string) and `knock_message_id`. Cadence sets the click-through URL and icon through payload overrides (`webpush.fcm_options.link`, `webpush.notification.icon`), which accept Liquid. The link must be HTTPS and on Cadence's own host.
- **Surprise: no notification while Cadence is visible.** When a Cadence tab is visible, the Firebase service worker shows no system notification. It hands the message to the page's `onMessage` instead.
- **iPhone.** Push works only on iOS/iPadOS 16.4+ after the person adds Cadence to the Home Screen. That needs a web app manifest with `display: standalone` or `fullscreen`, and the permission prompt must follow a tap. Cadence has no manifest today. Firebase lists Cloud Messaging as supported on iOS Safari.
- **Tests.** Nothing Cadence runs on the server talks to Firebase. A `NotificationTransport` shaped like `MailTransport` (real Knock client when `KNOCK_API_KEY` is set, a file-writing fake otherwise) keeps `npm run test` offline, as long as channel-data writes also go through it.

---

## 1. Firebase project setup, keys and config

### What gets created

1. **A Firebase project with a Web app registered.** That registration produces the web config object. The config fields are `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, plus `databaseURL` and `measurementId` when those apply. Firebase calls them "unique, but non-secret identifiers for your Firebase project and app". ([Firebase: config object](https://firebase.google.com/docs/web/learn-more#config-object))
2. **A VAPID key pair**, made in Firebase console > Settings > General > Cloud Messaging > Web configuration > Web Push certificates > "Generate Key Pair". An existing pair can be imported instead, which needs owner access. ([FCM web client](https://firebase.google.com/docs/cloud-messaging/js/client))
   - The public key is passed to the SDK as `vapidKey`.
   - The private key never leaves Firebase.
   - If no `vapidKey` is passed, the SDK falls back to a default key. "Some push services (Chrome Push Service) require a non-default VAPID key", so Firebase recommends generating one. ([GetTokenOptions](https://firebase.google.com/docs/reference/js/messaging_.gettokenoptions))
3. **The FCM Registration API, enabled.** It is required for SDK 6.7.0+ and is on by default for new projects. ([FCM web client](https://firebase.google.com/docs/cloud-messaging/js/client))
4. **A service account private key**, from Firebase console > Settings > Service accounts > "Generate New Private Key". Firebase says to store it securely. ([FCM: authorize send requests](https://firebase.google.com/docs/cloud-messaging/auth-server)) Knock's FCM channel needs two values per Knock environment: **Project ID** and **Service account JSON** (the whole file). ([Knock: FCM](https://docs.knock.app/integrations/push/firebase))

### Public vs secret

| Value | Where it lives | Secret? | Source |
| --- | --- | --- | --- |
| Firebase web config (`apiKey`, `projectId`, `messagingSenderId`, `appId`, …) | Browser bundle and the service worker | No. Firebase says API keys for Firebase services "are OK to include in code or checked-in config files" | [Firebase: API keys](https://firebase.google.com/docs/projects/api-keys) |
| VAPID **public** key | Browser bundle (`vapidKey`) | No (it is a public key) | [GetTokenOptions](https://firebase.google.com/docs/reference/js/messaging_.gettokenoptions) |
| VAPID **private** key | Firebase console only | Yes | [FCM web client](https://firebase.google.com/docs/cloud-messaging/js/client) |
| Service account JSON | Knock dashboard only (FCM channel, per environment). Cadence does not need it | Yes (a credential for Google APIs) | [Knock: FCM](https://docs.knock.app/integrations/push/firebase), [GCP: service account keys](https://cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys) |
| Knock secret API key | Cadence server (`KNOCK_API_KEY`, which `@knocklabs/node` reads by default) | Yes | [knock-node README](https://github.com/knocklabs/knock-node) |
| Knock public API key | Browser, only if the browser talks to Knock (the in-app feed, or setting channel data from the client) | No, but production should turn on enhanced security mode | [Knock: security](https://docs.knock.app/in-app-ui/security-and-authentication) |
| Knock signing key (RS256) | Cadence server, only with enhanced security mode | Yes | [Knock: security](https://docs.knock.app/in-app-ui/security-and-authentication) |
| Knock FCM channel ID (UUID v4) | Cadence server, to call `setChannelData` | No | [Knock: setting channel data](https://docs.knock.app/managing-recipients/setting-channel-data) |
| The FCM token (or FID) itself | Knock channel data | Firebase says "Registration tokens must be kept secret" | [FCM: server environment](https://firebase.google.com/docs/cloud-messaging/server-environment) |

How the public values reach the browser (fact): Vite exposes only `VITE_`-prefixed variables to client code through `import.meta.env`, and warns that they end up in the bundle. ([Vite: env and modes](https://vite.dev/guide/env-and-mode.html)) A root loader that returns the values is another option. Vite's docs do not say that env values are replaced inside `public/` files, and the next section explains why they are not.

## 2. Serving `firebase-messaging-sw.js` in this repo

### What this repo does today

- `npm run dev` runs `react-router dev`, which is Vite. `npm run build` runs `react-router build`, which writes `build/client` and `build/server`. `npm start` runs `react-router-serve ./build/server/index.js`. (`package.json`)
- **Version note:** `package.json` pins `react-router` and `@react-router/*` at **8.3.0**, not 7. Vite is `^7.1.7`, and 7.3.7 is installed.
- `vite.config.ts` has only the Tailwind, React Router and tsconfig-paths plugins: no PWA or service-worker plugin. `react-router.config.ts` has `ssr: true`.
- There is **no service worker and no web app manifest**. `public/` holds only `favicon.svg` and `images/`. `app/root.tsx` `links()` adds only the SVG favicon and Google Fonts. Nothing needs merging today.
- No Dockerfile or deploy config ships the app. The one under `.sandcastle/` is for agent sandboxes. "Production" here means `npm run build && npm start`.

### How a file in `public/` is served

- **Vite.** Files in `public/` are "served at root path `/` during dev" and "copied to the root of the dist directory as-is" on build. ([Vite: the public directory](https://vite.dev/guide/assets.html#the-public-directory)) For React Router, that dist directory is `build/client`.
- **`react-router-serve` 8.3.0** (`node_modules/@react-router/serve/dist/cli.js`, lines 113–120):
  - `/assets/*` from `build/client/assets` is served with `immutable, maxAge: "1y"`.
  - Everything else in `build/client` goes through `express.static` with default options, so no long max-age.
  - `public/` is a fallback with `maxAge: "1h"`.
  - So `public/firebase-messaging-sw.js` is served from `build/client` at `/firebase-messaging-sw.js` with no long cache.
- **Service worker caching.** The browser ignores HTTP caching for the main worker script anyway. `updateViaCache` defaults to `"imports"`, so the main script is always rechecked over the network, while `importScripts()` URLs still use the HTTP cache. ([MDN: updateViaCache](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache))

### What has to go in the file

- **The file must exist.** "FCM requires a `firebase-messaging-sw.js` file … create an empty file with that name and place it in the root of your domain before registering." ([FCM web client](https://firebase.google.com/docs/cloud-messaging/js/client))
- **Defaults.** If no registration is passed to the SDK, it registers `/firebase-messaging-sw.js` with scope `/firebase-cloud-messaging-push-scope`. ([SDK source: `constants.ts`](https://github.com/firebase/firebase-js-sdk/blob/main/packages/messaging/src/util/constants.ts)) `GetTokenOptions.serviceWorkerRegistration` (also used by `RegisterOptions`) accepts an existing registration instead. "If the registration is not provided explicitly, you need to have a firebase-messaging-sw.js at your root location." ([GetTokenOptions](https://firebase.google.com/docs/reference/js/messaging_.gettokenoptions), [messaging reference](https://firebase.google.com/docs/reference/js/messaging_))
- **The worker needs the Firebase config.** It calls `initializeApp({...config})` and then `getMessaging()`, so it needs the web config as literal values. ([FCM: receive messages](https://firebase.google.com/docs/cloud-messaging/js/receive)) Files in `public/` are copied "as-is", so `import.meta.env` is not replaced in them (inferred from the Vite docs above). The config is non-secret, so writing it into the file is allowed. It does differ between Firebase projects, for example dev and production.
- **Module imports.** "To use the modular SDK in a service worker, you must bundle your service worker file … If you don't want to bundle your service worker file, you can use the namespaced API provided by the compat packages" via `importScripts('https://www.gstatic.com/firebasejs/<ver>/firebase-app-compat.js')` and `firebase-messaging-compat.js`. ([FCM: receive messages](https://firebase.google.com/docs/cloud-messaging/js/receive))
- **Custom click handling.** A `notificationclick` listener has to be added *before* importing FCM, "Otherwise, FCM may overwrite the custom behavior." (same source)

### The options, as facts

| Approach | What it means here |
| --- | --- |
| Static `public/firebase-messaging-sw.js`, compat build via `importScripts` from gstatic | Works in dev and with `react-router-serve` with no config change. The Firebase config is hard-coded, or picked by hostname. The gstatic version is pinned in the file. |
| Bundle the worker (modular SDK) | Needs a separate build step or Vite plugin. Nothing in this repo does that today. |
| Serve the worker from a React Router **resource route** (a loader that returns a `Response` with a JS content type, no default export) | Resource routes can return any `Response`. ([React Router: resource routes](https://reactrouter.com/how-to/resource-routes)) That would let the server fill in config from env. **Not verified:** the docs show no route path ending in `.js`, and a file of the same name in `public/` would be served first in production. |
| A future app-wide service worker (offline/PWA) | Only one registration exists per scope. Calling `register()` again for the same scope updates that registration's script URL rather than adding a second one. A worker's scope cannot be wider than its own path unless the server sends `Service-Worker-Allowed`. ([MDN: register](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)) To share one worker, import Firebase messaging into it and pass its registration as `serviceWorkerRegistration`. |

### HTTPS in dev and production

- "The FCM SDK is supported only in pages served over HTTPS." ([FCM web client](https://firebase.google.com/docs/cloud-messaging/js/client))
- `http://localhost` is a secure context, so service workers run on `react-router dev`'s localhost. ([MDN: secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts))
- Testing from a phone against a LAN IP over plain HTTP is *not* a secure context, so it needs an HTTPS tunnel or a deployed host (inferred from the same page).

## 3. Getting a browser's token onto the Knock user

### Knock's side

- **Shape.** FCM channel data is `{ "tokens": string[] }` or `{ "devices": [{ "token", "locale", "timezone" }] }`. If a user has several tokens, Knock "will generate and try to deliver a notification for each unique token." ([Knock: FCM](https://docs.knock.app/integrations/push/firebase), [device metadata](https://docs.knock.app/integrations/push/device-metadata))
- **API.**
  - Set: `PUT /v1/users/{user_id}/channel_data/{channel_id}` with `{ "data": { "tokens": [...] } }`. This creates the Knock user if it does not exist.
  - Delete: `DELETE` on the same path.
  - Node SDK: `client.users.setChannelData(userID, channelID, {...})`, `getChannelData`, `unsetChannelData`.
  - ([API: set channel data](https://docs.knock.app/api-reference/users/set_channel_data), [unset](https://docs.knock.app/api-reference/users/unset_channel_data), [knock-node api.md](https://github.com/knocklabs/knock-node/blob/main/api.md))
- **Set replaces.** "Setting channel data replaces the existing data for that channel." ([Knock: setting channel data](https://docs.knock.app/managing-recipients/setting-channel-data)) There is no documented append or remove-one-token call. Adding or removing one browser is therefore read, change, write, and two devices registering at the same time can overwrite each other (inference).
- **No channel data, no push.** If a recipient has no channel data for a push channel, "the channel step will be skipped." (same source)
- **From the server or the browser.**
  - For web, Knock's FCM page says to send the token "to your app server and use the corresponding Knock SDK to set the channel data." ([Knock: FCM](https://docs.knock.app/integrations/push/firebase))
  - The public API key *can* call get, set and unset channel data from the browser. Production should enable **enhanced security mode**, where the client also sends an RS256-signed user token made by the server. That token can be limited with the `channel_data/write` grant. ([Knock: security](https://docs.knock.app/in-app-ui/security-and-authentication))
  - Knock's React SDK has no web-push registration helper; its reference lists none. ([React SDK reference](https://docs.knock.app/in-app-ui/react/sdk/reference)) Knock's mobile SDKs do have push registration helpers.

### Firebase's side: tokens are being replaced by Installation IDs

- **Docs status (last updated 2026-11-10).** FCM "is transitioning from registration tokens to a registration system based on Firebase Installation IDs (FIDs) … both patterns are fully co-supported." ([FCM: registration best practices](https://firebase.google.com/docs/cloud-messaging/manage-tokens))
- **New API.** `register(messaging, { vapidKey, serviceWorkerRegistration })` delivers the FID to `onRegistered(messaging, cb)`. That callback fires "every time a manual register() finishes, a FID change is detected, or a pushsubscriptionchange event is fired." `unregister()` and `onUnregistered()` cover removal. ([FCM web client](https://firebase.google.com/docs/cloud-messaging/js/client), [messaging reference](https://firebase.google.com/docs/reference/js/messaging_))
- **When it shipped.** It arrived in Firebase JS SDK **12.14.0 (May 28, 2026)**: "Added new API for creating and deleting Cloud Messaging registration." The current version is 13.2.0. ([release notes](https://firebase.google.com/support/release-notes/js), `npm view firebase`)
- **`getToken()` is "now obsolete".** It still returns a token, and it asks for notification permission itself if permission has not been granted. ([messaging reference](https://firebase.google.com/docs/reference/js/messaging_))
- **Don't mix the two.** "Don't use both the Firebase Installation ID APIs and the deprecated registration token APIs for registration management at the same time." ([FCM web client](https://firebase.google.com/docs/cloud-messaging/js/client))
- **Sending.** The FCM HTTP v1 `Message` now has a `fid` target. `token` is deprecated: "During the transition period, this field also accepts a Firebase Installation ID (FID)." ([FCM REST: projects.messages](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages))
- **Knock's docs say nothing about FIDs.** Searched: the FCM page, the channel data pages and `llms.txt`. They talk only about "device tokens" from `getToken`-era quickstarts. Two paths follow:
  - Keep using `getToken()`. It is documented by Knock, but obsolete in Firebase.
  - Store FIDs in Knock's `tokens`. This works only if Knock puts them in FCM's `token` field, which accepts FIDs "during the transition period". Knock does not document this either way. **Not verified**; it needs a test send or a question to Knock.

### Refresh and stale registrations

- **With `getToken()`.** "The client SDK does not automatically manage refreshes." Firebase recommends getting the token on app start (or about monthly) and saving it with a timestamp. It treats a registration as stale after about a month without a connection. ([FCM: registration best practices](https://firebase.google.com/docs/cloud-messaging/manage-tokens))
- **With `register()`.** `onRegistered()` delivers the current FID on startup syncs and whenever it changes. (same source)
- **Bad tokens.** Knock's **token deregistration** removes a token from channel data when a send bounces with `UNREGISTERED` or `INVALID_ARGUMENT`. It is per environment, "default to `ON` when you first create a channel", and emits a `message.bounced` webhook. ([Knock: token deregistration](https://docs.knock.app/integrations/push/token-deregistration)) Knock does no age-based pruning, and its `devices` object has no timestamp field. So "last seen" staleness tracking would need Cadence's own storage (inference).

### Sign-out

- **In the browser.** `deleteToken(messaging)` "Deletes the registration token … and unsubscribes the Messaging instance from the push subscription." With FID registration, it deletes that registration and fires `onUnregistered()`. ([messaging reference](https://firebase.google.com/docs/reference/js/messaging_))
- **In Knock.** Knock keeps the token until Cadence removes it, because "Knock makes no assumptions about managing your device tokens." ([Knock: FCM](https://docs.knock.app/integrations/push/firebase)) Removing it means read, filter, write, or `unsetChannelData` when it was the last token.
- **This repo (fact).** `app/routes/api.logout.ts` only calls `destroySession`. The server never learns the browser's token unless the client sends it, or Cadence stores a token-to-session mapping.
- **DevUI user switching** (`app/routes/api.switch-user.ts`) changes users in the same browser. Without cleanup, one browser's token could be attached to several Knock users (inference).

## 4. What Knock's FCM channel sends for web

- **Push template.** Knock's push template has `title`, `text_body` and `settings` (`delivery_type: "content" | "silent"`, `payload_overrides`). ([Knock MAPI: PushTemplate](https://docs.knock.app/mapi-reference/templates/schemas/push_template))
- **What Knock always adds.** Knock always sends `knock_message_id` and `data`, which is the trigger data with nested objects flattened to dot keys and every value turned into a string (`"foo.bar.0": "21"`). ([Knock: FCM](https://docs.knock.app/integrations/push/firebase))
- **Not documented.** Knock does **not** document the exact FCM `Message` it builds for a content push, for example whether title and body go in `notification` or `webpush.notification`. Checking needs a test send in Knock's development environment.
- **Silent pushes.** A silent template sends only `data`: "we'll no longer pass through the message payload." (same source)

**Overrides.**

- Overrides can be set on the channel per environment, or per template. Template-level overrides "take precedence and replace the channel-level overrides".
- Keys: `apns`, `data`, `android`, `fcm_options`, `notification`, `webpush`.
- They are merged by default; `"__strategy__": "replace"` replaces instead.
- They support Liquid over `data` and recipient properties.
- ([Knock: push overview](https://docs.knock.app/integrations/push/overview), [Knock: FCM](https://docs.knock.app/integrations/push/firebase))

**FCM's web fields** ([FCM REST: WebpushConfig](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages)):

- `webpush.headers` holds Web Push protocol headers such as `TTL`.
- `webpush.data` overrides the top-level `data`.
- `webpush.notification` accepts "Notification instance properties as defined in Web Notification API", so `icon`, `badge`, `image`, `tag`, `requireInteraction`, `actions` and so on. Its `title` and `body` override the top-level ones.
- `webpush.fcm_options.link` is the click-through. "For all URL values, HTTPS is required."

**Click-through behaviour.**

- `fcm_options.link`, or failing that `notification.click_action`, gives the URL. If a tab is already open on that URL it is focused; otherwise a new tab opens. ([FCM: receive messages](https://firebase.google.com/docs/cloud-messaging/js/receive))
- The SDK's service worker **only opens links on the worker's own host**. Links to other hosts are ignored. ([SDK source: `sw-listeners.ts` `onNotificationClick`](https://github.com/firebase/firebase-js-sdk/blob/main/packages/messaging/src/listeners/sw-listeners.ts))
- "Data messages don't support fcm_options.link", so Firebase recommends a notification payload. Otherwise the worker has to call `showNotification` itself in `onBackgroundMessage`. ([FCM: receive messages](https://firebase.google.com/docs/cloud-messaging/js/receive))

**Foreground vs background.**

- If any Cadence window is visible, the SDK's worker **does not display a notification**. It passes the message to `onMessage` in the page.
- In the background, it shows a notification only when the message has a `notification` part, then calls `onBackgroundMessage`.
- ([SDK source: `sw-listeners.ts` `onPush`](https://github.com/firebase/firebase-js-sdk/blob/main/packages/messaging/src/listeners/sw-listeners.ts), [FCM: receive messages](https://firebase.google.com/docs/cloud-messaging/js/receive) table)

**Icon.**

- Firebase recommends sending `icon`, usually the app logo. ([FCM: receive messages](https://firebase.google.com/docs/cloud-messaging/js/receive))
- Cadence today has only `public/favicon.svg`, no PNG icons.

**Example override (illustrative).** The shape follows the FCM and Knock docs. The data keys and host are placeholders.

```json
{
  "webpush": {
    "notification": { "icon": "https://<cadence-host>/icons/icon-192.png" },
    "fcm_options": { "link": "https://<cadence-host>{{ data.path }}" }
  }
}
```

## 5. Safari and iPhone

- **Which Apple browsers.**
  - macOS: Safari 16 on macOS Ventura and later. ([WebKit: Meet Web Push](https://webkit.org/blog/12945/meet-web-push/))
  - iOS/iPadOS: 16.4 and later, **only for web apps added to the Home Screen** (Share menu > "Add to Home Screen"). ([WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/))
  - MDN's compat data for `PushManager` on Safari iOS says: "Notifications are supported in web apps saved to the home screen." ([MDN: PushManager](https://developer.mozilla.org/en-US/docs/Web/API/PushManager))
- **What iOS requires.**
  - A web app manifest whose `display` is `standalone` or `fullscreen`. ([WebKit 13878](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [MDN: display](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display))
  - Permission may be requested only "in response to direct user interaction". Safari's subscribe also needs an "explicit user gesture". ([WebKit 13878](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [WebKit 12945](https://webkit.org/blog/12945/meet-web-push/))
  - No Apple Developer Program membership.
  - If outgoing push endpoints are allowlisted, allow `*.push.apple.com`.
  - The Badging API is available.
  - Notifications follow Focus modes, and permissions are managed per web app in Settings.
  - (Same sources.)
- **Silent pushes on Safari.** Pushes "will always be user visible": "Violations of the `userVisibleOnly` promise will result in a push subscription being revoked." ([WebKit 12945](https://webkit.org/blog/12945/meet-web-push/)) This bears on Knock's silent (data-only) push setting.
- **Firebase support.** Firebase's support matrix marks Cloud Messaging supported in Safari and iOS Safari. ([Firebase: supported environments](https://firebase.google.com/support/guides/environments_js-sdk)) The SDK's `isSupported()` returns `true` only if `serviceWorker`, `PushManager`, `Notification`, IndexedDB and cookies are all available. ([SDK source: `isSupported.ts`](https://github.com/firebase/firebase-js-sdk/blob/main/packages/messaging/src/api/isSupported.ts)) In an iPhone Safari tab that has not been added to the Home Screen, `PushManager` is absent, so `isSupported()` is false (inferred from MDN's data).
- **`getToken()` and the user gesture.** `getToken()` prompts for permission when none has been granted ([messaging reference](https://firebase.google.com/docs/reference/js/messaging_)). On iOS it would therefore need to run inside a tap handler, or after an explicit `Notification.requestPermission()` (inference).
- **Cadence today.** There is no manifest and no `<link rel="manifest">` in `app/root.tsx`, and there are no PNG icons. The manifest `icons` member is documented on [MDN: icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons). Testing on a real iPhone needs HTTPS (section 2).

## 6. Keeping it out of `npm run test`

- **The pattern to copy.** `app/lib/mailer.server.ts` (present in the main checkout, from commit `cfd16d5`) defines a `MailTransport` interface with two implementations: `postmarkTransport(token)` and `outboxTransport(dir)`, which writes JSON files to `.outbox/`. `defaultTransport()` picks one based on whether `POSTMARK_SERVER_TOKEN` is set, and `sendEmail(email, transport = defaultTransport())` lets tests pass their own transport in.
- **The test runner.** `vitest.config.ts` sets no `environment`, so tests run in Node. There is no `window`, `navigator.serviceWorker` or `Notification` there, so browser-only Firebase code and the service worker are naturally out of reach of `npm run test` as long as server modules don't import them.
- **Cadence's server never calls Firebase.** Knock holds the service account and talks to FCM. So the server needs no Firebase fake. The only outbound calls are Knock calls:
  - triggering workflows;
  - `users.setChannelData`, `getChannelData` and `unsetChannelData` to keep tokens up to date.
  - The fake has to cover both, or token registration would reach Knock during tests (inference from the API surface above).
- **Picking the real client by env var.** `@knocklabs/node` reads `KNOCK_API_KEY` by default ([knock-node README](https://github.com/knocklabs/knock-node)). Choosing the real transport by "`KNOCK_API_KEY` is set", the way the mailer checks `POSTMARK_SERVER_TOKEN`, matches the existing pattern. A key exported in a developer's shell would therefore switch tests to real Knock unless tests inject the fake explicitly (inference).
- **Knock's own sandboxing.** Knock gives each environment its own keys and channel config. The FCM channel has a per-environment "Sandbox mode" toggle, but Knock does not document what it does. ([Knock: FCM](https://docs.knock.app/integrations/push/firebase)) The ADR states that "Knock does not run offline", hence the fake.

## Open questions this surfaced (decisions, not facts)

1. Token or FID: should Cadence register browsers with Firebase's obsolete `getToken()` (what Knock documents), or with `register()`/`onRegistered()` FIDs (what Firebase now recommends), and does Knock confirm FIDs work in `tokens`?
2. Should channel data be written by Cadence's server (secret key, read-change-write), or by the browser with Knock enhanced security and a `channel_data/write` user token?
3. Does Cadence keep its own table of push registrations (user, token, last seen), so it can drop stale ones, clean up on sign-out or DevUI user switch, and avoid concurrent overwrites? Or does it rely on Knock's token deregistration alone?
4. On sign-out, should Cadence call `deleteToken()` in the browser and remove that token from Knock, and how does the server learn which token belongs to the session ending?
5. When and where does Cadence ask for notification permission, given that iOS requires a tap and the Home Screen install comes first?
6. Does Cadence add a web app manifest (`display: standalone`, PNG icons) and an "Add to Home Screen" prompt for iPhone students?
7. Service worker strategy: a static `public/firebase-messaging-sw.js` using the compat `importScripts`, a bundled worker, or a resource route that injects per-environment config? Does Cadence plan an app-wide worker that Firebase must share?
8. When a Cadence tab is visible, no system notification shows. Should the page show a toast in `onMessage`, or leave it to Knock's in-app feed?
9. Which click-through URL and icon does each workflow send? Are they set once on the channel or per template?
10. Are Knock silent (data-only) pushes off-limits, given Safari revokes subscriptions that don't show a notification?

## Sources

- Knock: [FCM integration](https://docs.knock.app/integrations/push/firebase), [push overview](https://docs.knock.app/integrations/push/overview), [token deregistration](https://docs.knock.app/integrations/push/token-deregistration), [device metadata](https://docs.knock.app/integrations/push/device-metadata), [setting channel data](https://docs.knock.app/managing-recipients/setting-channel-data), [API: set channel data](https://docs.knock.app/api-reference/users/set_channel_data), [API: unset channel data](https://docs.knock.app/api-reference/users/unset_channel_data), [security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication), [PushTemplate schema](https://docs.knock.app/mapi-reference/templates/schemas/push_template), [React SDK reference](https://docs.knock.app/in-app-ui/react/sdk/reference), [knock-node](https://github.com/knocklabs/knock-node)
- Firebase: [FCM web client setup](https://firebase.google.com/docs/cloud-messaging/js/client), [receive messages (web)](https://firebase.google.com/docs/cloud-messaging/js/receive), [registration best practices](https://firebase.google.com/docs/cloud-messaging/manage-tokens), [HTTP v1 Message reference](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages), [JS messaging reference](https://firebase.google.com/docs/reference/js/messaging_), [GetTokenOptions](https://firebase.google.com/docs/reference/js/messaging_.gettokenoptions), [authorize send requests](https://firebase.google.com/docs/cloud-messaging/auth-server), [server environment](https://firebase.google.com/docs/cloud-messaging/server-environment), [API keys](https://firebase.google.com/docs/projects/api-keys), [config object](https://firebase.google.com/docs/web/learn-more#config-object), [supported environments](https://firebase.google.com/support/guides/environments_js-sdk), [JS release notes](https://firebase.google.com/support/release-notes/js), SDK source: [`constants.ts`](https://github.com/firebase/firebase-js-sdk/blob/main/packages/messaging/src/util/constants.ts), [`sw-listeners.ts`](https://github.com/firebase/firebase-js-sdk/blob/main/packages/messaging/src/listeners/sw-listeners.ts), [`isSupported.ts`](https://github.com/firebase/firebase-js-sdk/blob/main/packages/messaging/src/api/isSupported.ts)
- WebKit: [Meet Web Push](https://webkit.org/blog/12945/meet-web-push/), [Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- MDN: [ServiceWorkerContainer.register](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register), [updateViaCache](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache), [PushManager](https://developer.mozilla.org/en-US/docs/Web/API/PushManager), [secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), [manifest display](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display), [manifest icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons)
- Vite: [the public directory](https://vite.dev/guide/assets.html#the-public-directory), [env variables and modes](https://vite.dev/guide/env-and-mode.html)
- React Router: [resource routes](https://reactrouter.com/how-to/resource-routes)
- Google Cloud: [service account key best practices](https://cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys)
- Repo: `package.json`, `vite.config.ts`, `react-router.config.ts`, `vitest.config.ts`, `app/root.tsx`, `app/routes/api.logout.ts`, `app/routes/api.switch-user.ts`, `node_modules/@react-router/serve/dist/cli.js`, `app/lib/mailer.server.ts` (main checkout)
