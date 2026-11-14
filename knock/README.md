# Knock templates

Cadence's Knock workflows and partials, kept in the repo so changes are reviewed. The layout is the Knock CLI's own (`knock.json` at the repo root sets `"knockDir": "knock"`):

```
knock/workflows/<workflow-key>/workflow.json   # steps, categories; `field@` points at a file beside it
knock/workflows/<workflow-key>/<step-ref>/...  # extracted template bodies
knock/partials/<partial-key>/partial.json      # + content.txt
```

These files were written by hand. The first time someone with access pushes them, run `npx @knocklabs/cli workflow pull --all` afterwards and commit anything Knock adds, so the files match Knock's own format.

## Rules (checked by `app/lib/notifications/knock-templates.test.ts`)

- Each workflow key Cadence triggers (`TRIGGER_DATA_FIELDS` in `app/lib/notifications/notify.server.ts`) has a folder here, and its templates read only `data.<field>`s listed there.
- Each workflow has one kind in `categories`: `waiting-on-you`, `about-you` or `activity`.
- Each workflow's headline and detail line live in one partial, `<workflow-key>-copy`, called with `part: 'headline'` or `part: 'detail'`. A partial sees only what's passed to it, never `data`.
- The in-app body (step with `channel_key: "in-app"`) is exactly the headline render, a blank line, then the detail render. The inbox splits it back apart with `splitInboxBody` (`app/lib/notifications/inbox-copy.ts`).
- Each `activity` workflow is in-app only, with a batch step first: `batch_key: "data.courseId"`, a fixed 1-hour window. One item per course per hour reaches the instructor when the window closes, and its partial gets `count: total_activities` to word one or many.
- Each browser push (step with `channel_key: "fcm"`) is sent by exactly the four push workflows: `refund-request-decided`, `new-open-refund-request`, `student-top-level-comment` and `instructor-or-platform-admin-reply`. Its `title` is the partial's headline render and its `text_body` the detail render, so push and inbox always say the same thing in plain text, quoted text cut to 100 characters by the partial. Its `settings.delivery_type` is `"content"` (never silent), and it has no `requireInteraction` or action buttons. The Inbox's push marker reads the same steps (`WORKFLOWS_SENT_BY_PUSH`).
- Each email (step with `channel_key: "postmark"`) ends with `<a href="{{ vars.app_url }}/settings">Manage notifications</a>`.

## Adding a workflow

1. Add its data type to `WorkflowData` and its fields to `TRIGGER_DATA_FIELDS` in `notify.server.ts` (the compiler will insist on the second).
2. Copy `workflows/refund-request-decided/` and `partials/refund-request-decided-copy/`, rename both, and edit the copy.
3. `npm run test`, then push to development (below) and `npm run test:knock`.

## Pushing to Knock

```sh
npx @knocklabs/cli login                      # or pass --service-token
npx @knocklabs/cli push --environment development
npx @knocklabs/cli commit -m "…" --environment development
npx @knocklabs/cli commit promote --to production
```

## One-time setup (by hand, per Knock environment)

1. **Channels.** Create an in-app channel with key `in-app`, a Postmark email channel with key `postmark` and a Firebase Cloud Messaging channel with key `fcm`. The keys are the same in every environment; each channel's id (a UUID) differs per environment.
2. **Postmark.** Make a Postmark account used only by Knock, with one server per Knock environment (development and production). Put each server's token in that environment's Postmark channel in Knock, never in Cadence. Send from `notifications@<Cadence's domain>`. Whoever owns the domain adds Postmark's DKIM and Return-Path DNS records.
3. **Firebase (browser push).** In the Firebase console, make one project per Knock environment (for example `cadence-dev` and `cadence-prod`), so a development token never reaches production:
   1. Project settings > General > Your apps: add a **Web app**. Its config (`apiKey`, `projectId`, `messagingSenderId`, `appId`) goes in Cadence's environment below. None of it is secret.
   2. Project settings > Cloud Messaging > Web Push certificates: **Generate key pair**. The public key is `FIREBASE_VAPID_KEY`.
   3. Project settings > Service accounts: **Generate new private key**. Paste that JSON, with the project id, into this environment's `fcm` channel in Knock. It lives only in Knock, never in Cadence.
4. **FCM channel settings** (Knock > Channels > `fcm` > this environment > Manage configuration > overrides). Replace `<host>` with this environment's host (the same as `app_url`, without `https://`):

   ```json
   {
     "webpush": {
       "headers": { "TTL": "259200" },
       "notification": {
         "icon": "https://<host>/icons/icon-192.png",
         "badge": "https://<host>/icons/badge-96.png",
         "tag": "{{ data.notificationId }}"
       },
       "fcm_options": { "link": "https://<host>{{ data.path }}" }
     }
   }
   ```

   The link opens the page the notification is about. The `tag` is the notification's id, so a repeat delivery replaces the earlier one, and the TTL (3 days, in seconds) drops a push that can't be delivered in time. Leave out `requireInteraction` and `actions`. Cadence's `/sw.js` has no `notificationclick` handler: Firebase focuses a tab already on the link, or opens one.

   If the first test send (below) shows no system notification, Knock isn't putting the title and body where Firebase's service worker reads them. Add them to the same override:

   ```json
   "notification": { "title": "{{ title }}", "body": "{{ body }}", … }
   ```

   using whichever variables the test send's FCM payload (Knock > Messages > the push > Request) shows, and note the answer here.
5. **Variables.** Set the environment variable `app_url` in Knock (Settings > Variables) to Cadence's base URL, with no trailing slash. Emails use it for absolute links.
6. **Cadence's environment.** Set all of these, or none:

   | Variable | Where to find it |
   |---|---|
   | `KNOCK_SECRET_KEY` | Developers > API keys (`sk_…`), server only |
   | `KNOCK_PUBLIC_KEY` | Developers > API keys (`pk_…`), reaches the browser through the root loader |
   | `KNOCK_IN_APP_CHANNEL_ID` | Channels > the `in-app` channel's id for this environment |
   | `KNOCK_FCM_CHANNEL_ID` | Channels > the `fcm` channel's id for this environment, server only |
   | `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID` | The Firebase web app's config (step 3), reaches the browser and `/sw.js` |
   | `FIREBASE_VAPID_KEY` | The Web Push certificate's public key (step 3), reaches the browser |

   Setting `KNOCK_SECRET_KEY` without the rest stops the server at startup. They're listed in `KNOCK_SETTINGS` (`app/lib/notifications/config.server.ts`).
7. **Default notification preferences.** In the environment's default preference set (Preferences > Default preference set, or the Management API), turn on every channel of each workflow below at the workflow level. This is what a person has until they change something on Settings → Notifications. Leave the workflows' "override preferences" setting off: it would lock push too.

   | Workflow | Channel types on |
   |---|---|
   | `refund-request-decided` | push, email |
   | `instructor-or-platform-admin-reply` | push, email |
   | `student-top-level-comment` | push, email |
   | `new-open-refund-request` | push |

   The list is `WORKFLOW_CHANNELS` in `app/lib/notifications/preference-defaults.ts`; keep the two in step. Knock treats a missing preference as on, and so does Cadence, so forgetting this step changes nothing a person sees. It's still set, so Knock's dashboard shows the intended defaults.

## Notification preferences

Settings → Notifications (`app/routes/settings.tsx`, `#notifications`, which the Inbox drawer's gear opens) reads and writes each person's workflow-level preferences straight from Knock (`GET`/`PUT /v1/users/{id}/preferences/default`, merged), not through the outbox. The rows per role, and the rule that email for refund request decided, issued refund and failed refund can't be turned off, are in `app/lib/notifications/preferences.server.ts`. Without Knock keys, preferences are saved to `.outbox/notification-preferences/<userId>.json`, starting from the defaults.

## Browser push

A person turns on push from the "Browser push in this browser" row at the top of Settings → Notifications (hidden when Knock isn't configured). The browser side is `app/lib/notifications/browser-push.ts`: `registerBrowserForPush()` registers Cadence's `/sw.js` (`app/routes/sw.ts`, which writes in this environment's Firebase config and loads Firebase's compat scripts at the exact `firebase` version in `package.json`), asks Firebase for the browser's token with `getToken()`, and posts it to `/api/push-registration`. The server stores it in the push registrations table (`app/lib/push-registrations.server.ts`) and keeps the registration's id in the session (`PUSH_REGISTRATION_SESSION_KEY` in `app/lib/session.ts`). Later asks reuse it through `useBrowserPush` (`app/lib/notifications/use-browser-push.ts`).

The table is the source of truth (`docs/adr/0014`). Every change queues a `setPushTokens` job in the outbox, at most one waiting per person, which writes the person's whole token list from the table when it's sent (`PUT /v1/users/{id}/channel_data/{fcm channel id}`), or unsets it when the list is empty (`DELETE` on the same path). Without Knock keys, the list is written to `.outbox/push-tokens/<userId>.json`, and the file goes when the list is empty.

Signing out (`app/routes/api.logout.ts`) and switching users in the DevUI (`app/routes/api.switch-user.ts`) go through `app/lib/sign-out.server.ts`: it reads the registration id from the session before changing it, deletes that row and queues the sync, so push stops even if the browser's JavaScript never runs. The browser also calls Firebase's `deleteToken()` when it can.

The manifest (`public/manifest.webmanifest`) and the icons in `public/icons/` (192 and 512 px app icons, the `apple-touch-icon` and the 96 px single-colour badge the FCM channel uses) were drawn by a script as plain placeholders; replace them with designed ones whenever there are some, keeping the file names.

## Checking by hand

With development keys in `.env`, run `npm run test:knock`, then `npm run dev`, decide a refund request at `/admin/refund-requests`, and confirm in Knock's development environment (Messages) that the buyer got an in-app message and an email.

Browser push, the first time and whenever the push setup changes (on `http://localhost`, which counts as secure; a phone needs an HTTPS tunnel):

1. Sign in as the buyer in the DevUI, open Settings → Notifications and press **Turn on browser push**. Allow the browser's prompt. The row says On, and Knock's development environment shows the token on the buyer (Users > the buyer > Channel data > `fcm`).
2. In another browser profile, sign in as a platform admin and decide the buyer's refund request at `/admin/refund-requests`. Switch the buyer's tab to another app or close it: Firebase shows a notification only when no Cadence tab is in front.
3. Confirm a system notification titled "We approved your refund request" (or declined) with the course and note as its body and the Cadence icon, and that clicking it opens the course page.
4. If nothing shows, open the push in Knock (Messages) and look where the title and body landed in the FCM request. Add `webpush.notification.title` and `body` to the channel override (setup step 4) and try again. Write down here which was needed.
5. Sign out as the buyer, decide another refund request, and confirm no notification arrives in that browser.

Raising a refund request sends `new-open-refund-request` to every platform admin. Deciding or withdrawing it bulk archives every copy, selected by `refundRequestId` (Knock matches the value's type too, so it's always a number). Without Knock keys, each bulk archive is written to `.outbox/bulk-archives/`.
