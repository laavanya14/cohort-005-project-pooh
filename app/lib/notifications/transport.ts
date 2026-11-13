// The Knock-facing interface: the one seam between Cadence and Knock.
// The real version calls Knock's API; without KNOCK_SECRET_KEY a fake writes
// files under .outbox/, and tests record calls in memory. Whichever is used
// is always passed in explicitly, never picked up by default.
//
// Bulk mark read by a trigger-data key, setPushTokens and preferences get/set
// join `trigger` and `bulkArchive` here as the tickets that need them land.

/** A person as Knock sees them. `id` is Cadence's user id. */
export type NotificationRecipient = {
  id: string;
  name: string;
  email: string;
};

export type TriggerRequest = {
  recipients: NotificationRecipient[];
  actor: NotificationRecipient;
  data: Record<string, unknown>;
};

/**
 * Picks in-app messages: every recipient's copy of one workflow's
 * notifications whose trigger data has `key` equal to `value`. Knock matches
 * the value exactly, including its type, so `7` never matches `"7"`.
 */
export type InAppMessageSelector = {
  workflowKey: string;
  key: string;
  value: string | number;
};

export type NotificationTransport = {
  /**
   * Runs a Knock workflow. `idempotencyKey` is the same on every retry of one
   * notification, so Knock never sends it twice. Rejects when Knock doesn't
   * accept it.
   */
  trigger(
    workflowKey: string,
    request: TriggerRequest,
    options: { idempotencyKey: string }
  ): Promise<void>;

  /**
   * Archives every in-app message the selector picks, whoever it was sent
   * to. Doing it twice is harmless. Rejects when Knock doesn't accept it.
   */
  bulkArchive(selector: InAppMessageSelector): Promise<void>;
};
