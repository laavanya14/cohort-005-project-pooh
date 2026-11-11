# Knock for notifications, with FCM for browser push

Cadence sends notifications (the in-app bell and inbox, browser push, and email through Postmark) through Knock, so one service routes every channel and applies every preference. Knock has no browser push of its own, so browser push goes through Knock's Firebase Cloud Messaging (FCM) channel. We chose Knock for the most mature React SDK of the services we compared (React 17–19, headless hooks, live updates), its sandbox and separate dev environment, and its first-class Postmark support.

## Considered Options

- **SuprSend.** It was ranked first because it is the only one with its own browser push (VAPID), a React inbox and a Postmark vendor, so no second vendor is needed. We turned it down in favour of Knock's more mature SDK and dev tooling. The other costs were branding on the free inbox and a smaller vendor.
- **Novu.** Open source and self-hostable. Turned down because browser push still needs FCM or a third party, and the free tier's 5-workflow cap is too small for Cadence's events.
- **Knock for inbox and email, with Cadence sending browser push itself through `web-push` and VAPID keys.** This avoids Firebase. Turned down because it takes browser push out of Knock's workflows and preferences, so Cadence would have to build routing, opt-out and delivery tracking for that one channel.

## Consequences

- Firebase becomes a second vendor, with its own project and keys, and Cadence needs a service worker for it. FCM itself is free.
- The free tier is 10,000 messages a month with no hard cap. A message is one delivery to one person on one channel, so an event sent to the inbox, browser and email counts three times. The next tier is $250 a month. We look at this again if volume gets close to the cap.
- Knock does not run offline, so local dev and tests fake it behind a `NotificationTransport` interface, the way `MailTransport` writes email to `.outbox/`.
- On iPhone, browser push works only after a Student adds Cadence to the Home Screen (iOS 16.4+). This would be true with any service.
