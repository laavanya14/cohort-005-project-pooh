# Which notification services fit Cadence?

Research for [#14](https://github.com/laavanya14/cohort-005-project-pooh/issues/14), part of the map [#13 Notifications in Cadence](https://github.com/laavanya14/cohort-005-project-pooh/issues/13). Compares **Knock, Courier, MagicBell, SuprSend and Novu** against the map's criteria. It ranks them but does not pick one. The pick happens in #16 "Which notification service do we use?".

- **Researched:** 2026-11-11. Pricing pages change often, so check them again before signing up.
- **Cadence today:** React 19.2 (`react@^19.2.7`), React Router 8.3.0, Postmark email behind `MailTransport` in `app/lib/mailer.server.ts`, which writes to `.outbox/` when there is no token.
- **Sources:** official pricing pages, official docs (each vendor's `llms-full.txt` docs export where it has one), and npm package metadata (`npm view <pkg> peerDependencies`). Vendor blog posts and marketing pages are used only where marked.

## Ranked shortlist

| # | Service | Why it ranks here | Main trade-off |
| - | --- | --- | --- |
| 1 | **SuprSend** | It is the only service on the list with all four channels built in: its own standards-based (VAPID) Web Push, a React inbox with a headless option, a Postmark vendor, and category × channel preferences. Its free plan of 10,000 notifications a month needs no credit card. | The free plan shows SuprSend branding in the inbox. It is a smaller vendor. Its docs say nothing about Safari or iPhone, though standard Web Push should work there under Apple's Home Screen rule. |
| 2 | **Knock** | It has the most complete React SDK: React 17–19 support, headless hooks, seen/read/interacted/archived state, and websockets. It has first-class Postmark support, preferences that Knock enforces on every send, and a sandbox mode plus a development environment for testing. Its free plan gives 10,000 messages with no credit card and no hard cap. | It has no Web Push of its own. Browser push goes through Firebase Cloud Messaging (FCM), which means a Firebase project and `firebase-messaging-sw.js`. The first paid plan is $250 a month. |
| 3 | **Novu** | It is open source and the only one that can **run fully on a laptop** (self-hosted in Docker), which helps local dev. Its inbox has read/unread/archive/snooze and a built-in Preferences view. It supports React 19 and Postmark. | It has no Web Push of its own: push goes through FCM, Pushpad, OneSignal or a "Push Webhook" to your own sender. The free plan allows **only 5 workflows**, 3 team members and 24h of activity history. Self-hosting needs MongoDB and Redis. |
| 4 | **Courier** | It has a solid inbox (v9; React 18+ and Web Components) with read/archive state synced live, a `CourierPreferences` component, Postmark support, and a Test environment with a built-in test email provider. Its free plan gives 10,000 sends a month. | It has no Web Push of its own (push goes through FCM, OneSignal or similar). Sends over the cap are `THROTTLED`, not delivered. |
| 5 | **MagicBell** | It has the best browser-push UX of the five: a native `WebPushButton` with an iPhone "add to Home Screen" prompt, plus an inbox, a preferences UI and archive. | Its free plan has **only 1,000 deliveries** a month. Postmark is not a documented email provider (only generic SMTP). There is no documented sandbox, the React package declares no React version range, and the first paid plan is $249 a month. |

Across all five, nobody offers an offline mode that `npm run test` could use. The workable plan is the one Cadence already uses for email: put the server-side "send a notification" call behind an interface, and use a file-writing fake (`.outbox/`-style) when there is no API key. The inbox and bell are the harder part to fake, because every vendor's React component talks to the vendor's backend. See [Running without the service](#running-without-the-service-in-local-dev-and-tests).

## 1. Free tier without a credit card

| Service | Free plan | Monthly limit | Other limits | Card? | First paid tier |
| --- | --- | --- | --- | --- | --- |
| Knock | Free (formerly "Developer") | 10,000 messages. One message is one delivery to one recipient on one channel, so email plus in-app counts as 2 | Unlimited channels, unlimited stored recipients | No card. No hard cap: Knock contacts you to add billing for the next month | Starter, $250/mo |
| Courier | Developer | 10,000 sends | Not priced per seat or per channel | Adding a card moves the workspace to Business. Sends over the cap are `THROTTLED` | Business, $0.005 per send |
| MagicBell | Builder | **1,000 deliveries** | Unlimited recipients, "all integrations" | Not stated on the pricing page | Startup, $249/mo (50,000 deliveries) |
| SuprSend | Free | 10,000 notifications | Unlimited channels and team members. The in-app feed carries SuprSend branding | "No Credit Card required" | Essentials, $100/mo (50,000, then $2 per 1,000) |
| Novu | Free | 10,000 workflow runs | **5 workflows**, 3 team members, 2 environments, 24h activity-feed retention, unlimited subscribers | No card | Pro, $30/mo. Team, $250/mo |

Sources: [Knock pricing](https://knock.app/pricing), [Knock plans and usage](https://docs.knock.app/manage-your-account/knock-plans), [Courier pricing](https://www.courier.com/pricing), and Courier's docs on plans ("Adding a credit card to a Developer workspace moves it to Business"; the 10,000-send cap produces `THROTTLED`), [MagicBell pricing](https://www.magicbell.com/pricing), [SuprSend pricing](https://www.suprsend.com/pricing), [Novu pricing](https://novu.co/pricing).

Novu's 5-workflow cap matters for Cadence. Each kind of event is usually its own workflow, and Cadence's likely events already go past five: Refund Request raised (to a Platform Admin), Approved Refund Request and Declined Refund Request (to the buyer, a Student or a Team Admin), Claimed Seat (to the Team Admin), and new Enrollment.

## 2. React inbox component

| Service | Package (version on 2026-11-11) | React range (from `peerDependencies`) | Prebuilt UI | Customisation | Headless |
| --- | --- | --- | --- | --- | --- |
| Knock | `@knocklabs/react` 0.15.1 | `^17 \|\| ^18 \|\| ^19`. Peers `next` and `@tanstack/react-router` are optional, so React Router needs nothing extra | `NotificationIconButton` (bell with unread/unseen badge), `NotificationFeedPopover`, `NotificationFeed`, toasts, preference center | `--rnf-*` CSS variables, `colorMode`, `renderItem` for custom cells | Yes: hooks in `@knocklabs/react-core` 0.17.1, or the `@knocklabs/client` JS SDK |
| Courier | `@trycourier/courier-react` 9.3.5 | `>=18` | Inbox (bell, unread badge, infinite scroll), toasts, `CourierPreferences` | `CourierInboxTheme`, custom views while the SDK manages state | Yes: low-level APIs in `@trycourier/courier-js`, plus Web Components in `@trycourier/courier-ui-inbox` |
| MagicBell | `@magicbell/react` 1.14.0 | **None declared**. The old `@magicbell/magicbell-react` 11.5.1 needs `>=18.3.1` | `Inbox`, `FloatingInbox` + `InboxButton` (bell), `WebPushButton`, `UserPreferences`, toasts | CSS custom properties, overridable class names, `unstyled`, swappable trigger, inbox and item components | Partial: `magicbell-js` client. `@magicbell/react-headless` belongs to the older SDK line |
| SuprSend | `@suprsend/react` 1.5.0 (the legacy `@suprsend/react-inbox` is end-of-support) | `>=16.8` | Drop-in inbox, feed and toast | Theming and custom rendering | Yes: `@suprsend/react-core` hooks, or `@suprsend/web-sdk` |
| Novu | `@novu/react` 3.19.2 | `^18 \|\| ^19` | `<Inbox />` built from `Bell`, `Notifications`, `InboxContent` and `Preferences` | Style overrides, replaceable elements and icons, tabs, filters, localisation | Yes: `useNotifications` / `useCounts` hooks, or `@novu/js` |

Sources: npm package metadata; [Knock React overview](https://docs.knock.app/in-app-ui/react/overview); [Courier Inbox overview](https://www.courier.com/docs/platform/inbox/inbox-overview); [MagicBell React components](https://www.magicbell.com/docs/libraries/magicbell-react); SuprSend docs ("Do **not** install the legacy `@suprsend/react-inbox` package"; "End of support for `@suprsend/react-inbox`"); [Novu Inbox overview](https://docs.novu.co/platform/inbox/overview), [Novu headless mode](https://docs.novu.co/platform/inbox/headless-mode).

On React Router: all five are plain client components. Novu's docs show `useNavigate` from `react-router` for routing when a notification is clicked. None of them need Next.js.

## 3. Browser Web Push

Apple's rules apply whichever service Cadence picks. Web Push came to iPhone and iPad in **iOS/iPadOS 16.4**, and only for web apps **added to the Home Screen**. Those apps need a manifest with `display: standalone` or `fullscreen`, and they must ask for permission in response to a tap. No Apple Developer account is needed. ([WebKit, 2023-02-16](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/))

| Service | Push of its own? | How it works | Service worker | Safari / iPhone |
| --- | --- | --- | --- | --- |
| SuprSend | **Yes, standard VAPID Web Push.** The sandbox already has VAPID keys | `useSuprSendClient().webpush.registerPush()`, called from a click, never on page load | `/serviceworker.js` at the site root, which `importScripts` the SuprSend SW script from jsDelivr (v4.0.0). The name can be changed with `swFileName` | Safari (macOS) is in the browser feature table: title and body only, no images or action buttons. Its docs don't mention iPhone, so Apple's Home Screen rule applies |
| MagicBell | **Yes, VAPID Web Push** | `<WebPushButton>` subscribes and unsubscribes, and has labels for "unsupported" and "install as PWA first" | `/sw.js` (via `serviceWorkerPath`), which `importScripts` MagicBell's hosted `sw.js` | Handled explicitly: `requestInstallLabel` for the iPhone Home Screen requirement |
| Knock | No: goes through **FCM** | The Firebase JS SDK `getToken()` with a VAPID key, then the token is saved to Knock as channel data | `firebase-messaging-sw.js` at the root | Works where the Push API is supported. Firebase's docs don't name a Safari version, so check this in a prototype |
| Courier | No: goes through FCM, OneSignal, Pusher Beams and similar | Provider SDK on the client. Courier routes the send | Whatever the provider needs | Depends on the provider |
| Novu | No: goes through FCM, OneSignal, Pushpad, Pusher Beams, or **Push Webhook** (Novu calls your endpoint and you send the Web Push yourself) | Provider SDK on the client, plus subscriber credentials in Novu | Whatever the provider needs | Depends on the provider |

Sources: SuprSend [React WebPush](https://docs.suprsend.com/docs/react-webpush) and [web push quick start](https://docs.suprsend.com/docs/web-push-quick-start); MagicBell [Web Push channel](https://www.magicbell.com/docs/channels/web_push) and [React components](https://www.magicbell.com/docs/libraries/magicbell-react); Knock [FCM integration](https://docs.knock.app/integrations/push/firebase) and [web push with FCM tutorial](https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm) ("Knock does not have a first-party web push channel"); [Firebase JS client](https://firebase.google.com/docs/cloud-messaging/js/client); Courier [push providers](https://www.courier.com/docs/integrations/push/overview); Novu [push integrations](https://docs.novu.co/platform/integrations/push) and [Push Webhook](https://docs.novu.co/platform/integrations/push/push-webhook).

For Cadence, which is built on Vite, the service worker is a static file in `public/` served from the root under every option. A vendor with push of its own (SuprSend, MagicBell) spares Cadence a Firebase project.

## 4. Email and an existing Postmark account

| Service | Postmark | Notes |
| --- | --- | --- |
| Knock | Yes, a [first-class provider](https://docs.knock.app/integrations/email/postmark) | Channel conditions can limit the Postmark channel to production |
| Courier | Yes, a [first-class provider](https://www.courier.com/docs/external-integrations/email/postmark) | Server API Token plus From Address. Message stream set per send through `override.config.MessageStream` |
| MagicBell | **No documented Postmark provider.** The docs list SES, Mailgun, Ping Email, SMTP and SendGrid | A marketing page mentions Postmark, but the docs don't. Postmark's SMTP relay through MagicBell's [generic SMTP provider](https://www.magicbell.com/docs/channels/email/smtp) is a guess, not confirmed |
| SuprSend | Yes, a [Postmark vendor](https://docs.suprsend.com/docs/postmark) | Sandbox email goes only to verified addresses (up to 5) |
| Novu | Yes, a [first-class provider](https://docs.novu.co/platform/integrations/email/postmark) | |

This means Cadence's existing refund emails (`app/routes/courses.$slug.refund.ts` when a Refund Request is raised, `app/routes/admin.refunds.tsx` when a Platform Admin decides it) could move into the service and keep the same Postmark account, with any service except MagicBell.

## 5. Preferences

| Service | Granularity | UI |
| --- | --- | --- |
| Knock | Channel types, single workflows, workflow categories, broadcast types. Knock enforces them on every workflow run | Hosted or custom preference center. Per-tenant preferences are Enterprise only |
| Courier | Topics in sections, per channel | `CourierPreferences` React component and a hosted page |
| MagicBell | Category × channel (`GET/PUT /channels/user_preferences`), plus topic subscriptions | `UserPreferences` component |
| SuprSend | Three levels: channel, category, and channels within a category | Headless hooks plus example UI |
| Novu | Workflow × channel. Workflows marked `critical` can't be turned off | `Preferences` view built into `<Inbox />` |

Sources: Knock docs ("channel types, individual workflows, workflow categories, and broadcast types"; [Knock plans](https://docs.knock.app/manage-your-account/knock-plans)); Courier docs (`@trycourier/courier-ui-preferences`); MagicBell [API v2 reference](https://www.magicbell.com/docs/api/reference) and [in-app channel](https://www.magicbell.com/docs/channels/in_app); SuprSend preferences docs; [Novu Inbox overview](https://docs.novu.co/platform/inbox/overview).

All five can do "event type × channel", so the map's open question (one switch per channel, or event × channel) does not narrow the choice.

## Running without the service in local dev and tests

| Service | Sandbox or test environment | Offline / local | Boundary to fake |
| --- | --- | --- | --- |
| Knock | **Sandbox mode**, per channel or per workflow run (`sandbox_mode: true`): messages are generated but not delivered. A development environment is separate from production | None | Server SDK trigger (`workflows.trigger`). The bell and feed need Knock's API |
| Courier | **Test environment** with a Test API key and a built-in test email provider that sends only to your signup address | None | Server send API. The inbox needs a Courier JWT and the network |
| MagicBell | Nothing documented, apart from a dashboard push and SMTP tester | None | Server API |
| SuprSend | Sandbox workspace with vendors already set up, plus **test mode** that blocks final delivery | None. Self-hosting is not on the free plan | Server SDK trigger |
| Novu | Dev and Prod environments. `npx novu dev` runs a Local Studio, but it reaches the cloud through a tunnel | **Self-hosted Community Edition in Docker Compose** (MongoDB, Redis; about 8 GB RAM if built from source). Some cloud-only features are missing, and it pings home hourly even with telemetry off | Server SDK (`@novu/api`; `@novu/node` reached end of support on 2025-03-20) |

Sources: Knock [testing workflows](https://docs.knock.app/send-notifications/testing-workflows), [environments](https://docs.knock.app/version-control/environments); Courier docs (Test keys, "Every Test environment ships with the Courier Test Email Provider"); SuprSend docs ("Test Mode", "Send Notifications Only to Verified Channels in Sandbox"); Novu [self-hosting overview](https://docs.novu.co/community/self-hosting-novu/overview), [Docker deploy](https://docs.novu.co/community/self-hosting-novu/deploy-with-docker), Local Studio docs.

**What this means for Cadence.** With every option, the server side can copy `MailTransport`: a `NotificationTransport` interface with a real vendor implementation and an `.outbox/`-style file implementation, chosen by whether an API key is present. Then `npm run test` never touches the network. The in-app bell is harder, because each vendor's React component fetches from the vendor. Cadence would need to hide or stub the bell when there is no key, or use the headless hooks behind its own component so a local fake can supply data. Novu is the only one with a third route: point the bell at a local self-hosted Novu.

## 6. Real-time inbox and read/unread/archive state

| Service | Live updates | States |
| --- | --- | --- |
| Knock | Websocket managed by Knock. "All Knock feed components support real-time updates through websocket connections" | seen, read, interacted, archived (`archived_at`) |
| Courier | Websocket feed managed by Courier. New messages appear without a refresh, and read and archive state syncs across devices | read, unread, opened, archived |
| MagicBell | "Persistent connection" (the package depends on `reconnecting-websocket`) | read, unread, archived (`archivedAt` / `archiveNotification` in the package), delete |
| SuprSend | The component "handles WebSocket connections". Bell shows whether the feed is reachable | seen, clicked, read, unread, archived, unarchived. Expiry can be set per notification |
| Novu | `@novu/js` keeps a WebSocket open. Events include `notifications.notification_received` and `notifications.unread_count_changed` | read, unread, seen, archived, unarchived, snoozed |

All five meet this criterion. How long notifications are kept (an open map question) is clear only for SuprSend (expiry per notification). For Novu, 24h on the free plan is the *activity log* retention, not how long inbox items are kept. The others' docs don't state a retention period clearly.

## Open points to check in #16 or a prototype

- Whether Safari on an iPhone, with Cadence added to the Home Screen, actually receives push through SuprSend's service worker and through FCM (the Knock route).
- How each vendor treats Cadence's people: Students, Instructors, Platform Admins and Team Admins all become one kind of "recipient" (Knock and MagicBell call it a *user*, Novu a *subscriber*). Cadence would identify them by its own IDs.
- Whether SuprSend's free-plan branding in the inbox is acceptable.
