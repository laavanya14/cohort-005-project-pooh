import {
  defaultNotificationPreferences,
  mergeNotificationPreferences,
} from "~/lib/notifications/preference-defaults";
import type {
  InAppMessageSelector,
  NotificationPreferences,
  NotificationTransport,
  RecipientMessageSelector,
  TriggerRequest,
} from "~/lib/notifications/transport";

export type RecordedTrigger = TriggerRequest & {
  workflowKey: string;
  idempotencyKey: string;
};

/** One call Knock accepted, in the order it accepted them. */
export type RecordedCall =
  | ({ method: "trigger" } & RecordedTrigger)
  | ({ method: "bulkArchive" } & InAppMessageSelector)
  | ({ method: "bulkMarkRead" } & RecipientMessageSelector)
  | { method: "setPushTokens"; userId: string; tokens: string[] };

/** One `preferences.set` call Knock accepted. */
export type RecordedPreferenceChange = {
  userId: string;
  changes: NotificationPreferences;
};

/**
 * An in-memory stand-in for Knock. It records every trigger it accepts in
 * `triggers`, every bulk archive in `archives`, every bulk mark read in
 * `markReads`, and those and every push token write in `calls`, in the order it accepted them. `pushTokens` holds
 * the token list Knock has for each person who has one (writing an empty
 * list unsets it). `attempts` holds every trigger it was asked for,
 * accepted or not. Each person's preferences start from the defaults, and
 * every change it accepts is in `preferenceChanges`. `failNext()` makes the
 * next calls of any kind fail, as if Knock were down.
 */
export function createRecordingTransport() {
  const triggers: RecordedTrigger[] = [];
  const attempts: RecordedTrigger[] = [];
  const archives: InAppMessageSelector[] = [];
  const markReads: RecipientMessageSelector[] = [];
  const calls: RecordedCall[] = [];
  const preferenceChanges: RecordedPreferenceChange[] = [];
  const preferencesByUser = new Map<string, NotificationPreferences>();
  const pushTokens = new Map<string, string[]>();
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
    markReads: RecipientMessageSelector[];
    calls: RecordedCall[];
    preferenceChanges: RecordedPreferenceChange[];
    pushTokens: Map<string, string[]>;
    failNext(times?: number): void;
  } = {
    triggers,
    attempts,
    archives,
    markReads,
    calls,
    preferenceChanges,
    pushTokens,
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
    async bulkMarkRead(selector) {
      if (knockIsDown()) throw new Error("Knock is unavailable.");
      markReads.push({ ...selector });
      calls.push({ method: "bulkMarkRead", ...selector });
    },
    async setPushTokens(userId, tokens) {
      if (knockIsDown()) throw new Error("Knock is unavailable.");
      if (tokens.length === 0) pushTokens.delete(userId);
      else pushTokens.set(userId, [...tokens]);
      calls.push({ method: "setPushTokens", userId, tokens: [...tokens] });
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
