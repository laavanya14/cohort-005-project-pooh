// "Not now", "No thanks" or closing the browser's prompt stops Cadence's push
// asks in this browser for 30 days, per person. Kept in local storage, so it
// belongs to this browser only. Browser only: call from effects and handlers.

const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function storageKey(userId: number) {
  return `cadence-push-asks-snoozed-until:${userId}`;
}

/** When the person's snooze runs out, in ms, or null if they have none. */
export function pushAsksSnoozedUntil(userId: number): number | null {
  try {
    const stored = localStorage.getItem(storageKey(userId));
    if (stored === null) return null;
    const until = Number(stored);
    return Number.isFinite(until) ? until : null;
  } catch {
    // Local storage can be blocked. Then nothing is snoozed.
    return null;
  }
}

/** Stops the person's push asks in this browser for 30 days from `now`. */
export function snoozePushAsks(userId: number, now = Date.now()): number {
  const until = now + SNOOZE_MS;
  try {
    localStorage.setItem(storageKey(userId), String(until));
  } catch {
    // Local storage can be blocked. The snooze then lasts until a reload.
  }
  return until;
}
