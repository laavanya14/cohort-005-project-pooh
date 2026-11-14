import {
  defaultNotificationPreferences,
  mergeNotificationPreferences,
} from "~/lib/notifications/preference-defaults";
import type {
  InAppMessageSelector,
  NotificationPreferences,
  NotificationTransport,
  TriggerRequest,
} from "~/lib/notifications/transport";

export type RecordedTrigger = TriggerRequest & {
  workflowKey: string;
  idempotencyKey: string;
};

/** One call Knock accepted, in the order it accepted them. */
export type RecordedCall =
  | ({ method: "trigger" } & RecordedTrigger)
  | ({ method: "bulkArchive" } & InAppMessageSelector);

/** One `preferences.set` call Knock accepted. */
export type RecordedPreferenceChange = {
  userId: string;
  changes: NotificationPreferences;
};

/**
 * An in-memory stand-in for Knock. It records every trigger it accepts in
 * `triggers`, every bulk archive in `archives`, and both in `calls`, in the
 * order it accepted them. `attempts` holds every trigger it was asked for,
 * accepted or not. Each person's preferences start from the defaults, and
 * every change it accepts is in `preferenceChanges`. `failNext()` makes the
 * next calls of any kind fail, as if Knock were down.
 */
export function createRecordingTransport() {
  const triggers: RecordedTrigger[] = [];
  const attempts: RecordedTrigger[] = [];
  const archives: InAppMessageSelector[] = [];
  const calls: RecordedCall[] = [];
  const preferenceChanges: RecordedPreferenceChange[] = [];
  const preferencesByUser = new Map<string, NotificationPreferences>();
  let failuresLeft = 0;

  function knockIsDown() {
    if (failuresLeft <= 0) return false;
    failuresLeft -= 1;
    return true;
  }

  function preferencesOf(userId: string) {
    return preferencesByUser.get(userId) ?? defaultNotificationPreferences();
  }

  const transport: NotificationTransport & {
    triggers: RecordedTrigger[];
    attempts: RecordedTrigger[];
    archives: InAppMessageSelector[];
    calls: RecordedCall[];
    preferenceChanges: RecordedPreferenceChange[];
    failNext(times?: number): void;
  } = {
    triggers,
    attempts,
    archives,
    calls,
    preferenceChanges,
    failNext(times = 1) {
      failuresLeft = times;
    },
    async trigger(workflowKey, request, { idempotencyKey }) {
      const call = { workflowKey, idempotencyKey, ...request };
      attempts.push(call);
      if (knockIsDown()) throw new Error("Knock is unavailable.");
      triggers.push(call);
      calls.push({ method: "trigger", ...call });
    },
    async bulkArchive(selector) {
      if (knockIsDown()) throw new Error("Knock is unavailable.");
      archives.push({ ...selector });
      calls.push({ method: "bulkArchive", ...selector });
    },
    preferences: {
      async get(userId) {
        if (knockIsDown()) throw new Error("Knock is unavailable.");
        return preferencesOf(userId);
      },
      async set(userId, changes) {
        if (knockIsDown()) throw new Error("Knock is unavailable.");
        preferencesByUser.set(
          userId,
          mergeNotificationPreferences(preferencesOf(userId), changes)
        );
        preferenceChanges.push({ userId, changes });
      },
    },
  };

  return transport;
}
