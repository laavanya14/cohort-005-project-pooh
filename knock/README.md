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

1. **Channels.** Create an in-app channel with key `in-app` and a Postmark email channel with key `postmark`. The keys are the same in every environment; the in-app channel's id (a UUID) differs per environment.
2. **Postmark.** Make a Postmark account used only by Knock, with one server per Knock environment (development and production). Put each server's token in that environment's Postmark channel in Knock, never in Cadence. Send from `notifications@<Cadence's domain>`. Whoever owns the domain adds Postmark's DKIM and Return-Path DNS records.
3. **Variables.** Set the environment variable `app_url` in Knock (Settings > Variables) to Cadence's base URL, with no trailing slash. Emails use it for absolute links.
4. **Cadence's environment.** Set all of these, or none:

   | Variable | Where to find it |
   |---|---|
   | `KNOCK_SECRET_KEY` | Developers > API keys (`sk_…`), server only |
   | `KNOCK_PUBLIC_KEY` | Developers > API keys (`pk_…`), reaches the browser through the root loader |
   | `KNOCK_IN_APP_CHANNEL_ID` | Channels > the `in-app` channel's id for this environment |

   Setting `KNOCK_SECRET_KEY` without the rest stops the server at startup.

## Checking by hand

With development keys in `.env`, run `npm run test:knock`, then `npm run dev`, decide a refund request at `/admin/refund-requests`, and confirm in Knock's development environment (Messages) that the buyer got an in-app message and an email.
