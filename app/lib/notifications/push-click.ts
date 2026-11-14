// Clicking a push opens the page it's about with `?notification=<id>`. The
// app layout's loader sees the id, marks that person's inbox copy read and
// redirects to the clean URL (app/lib/notifications/push-click.server.ts).

/** The query parameter a push link carries the notification's id in. */
export const PUSH_CLICK_PARAM = "notification";

/**
 * The page a push opens: the notification's `path` with its id in the query.
 * The query goes before any `#comment-…` anchor, so the anchor still works.
 */
export function pushClickPath(path: string, notificationId: string) {
  const url = new URL(path, "http://cadence.invalid");
  url.searchParams.set(PUSH_CLICK_PARAM, notificationId);
  return `${url.pathname}${url.search}${url.hash}`;
}
