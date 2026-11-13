// The Knock-facing interface: the one seam between Cadence and Knock.
// The real version calls Knock's API; without KNOCK_SECRET_KEY a fake writes
// files under .outbox/, and tests record calls in memory. Whichever is used
// is always passed in explicitly, never picked up by default.
//
// Bulk archive / bulk mark read by a trigger-data key, setPushTokens and
// preferences get/set join `trigger` here as the tickets that need them land.

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
};
