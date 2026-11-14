// The Knock-facing interface: the one seam between Cadence and Knock.
// The real version calls Knock's API; without KNOCK_SECRET_KEY a fake writes
// files under .outbox/, and tests record calls in memory. Whichever is used
// is always passed in explicitly, never picked up by default.

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

/**
 * Picks one person's in-app messages whose trigger data has `key` equal to
 * `value`, from any workflow. `recipientId` is Cadence's user id. Knock
 * matches the value exactly, including its type.
 */
export type RecipientMessageSelector = {
  recipientId: string;
  key: string;
  value: string | number;
};

/** The channels a person can turn on or off. The inbox is always on. */
export type NotificationChannelType = "push" | "email";

/**
 * A person's notification preferences, by workflow key: whether each channel
 * is on. A channel or workflow left out is on, as Knock treats it.
 */
export type NotificationPreferences = Record<
  string,
  Partial<Record<NotificationChannelType, boolean>>
>;

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

  /**
   * Marks read the person's in-app messages the selector picks, such as the
   * inbox copy of a push they clicked. Doing it twice is harmless. Rejects
   * when Knock doesn't accept it.
   */
  bulkMarkRead(selector: RecipientMessageSelector): Promise<void>;

  /**
   * Replaces the browser push tokens Knock holds for a person with `tokens`,
   * their whole list, and unsets it when the list is empty. Cadence never
   * reads Knock's list (docs/adr/0014). Rejects when Knock doesn't accept it.
   */
  setPushTokens(userId: string, tokens: string[]): Promise<void>;

  /**
   * A person's notification preferences, which apply on every device. They
   * are read and written straight away, not through the outbox, so Settings
   * shows what Knock holds. Both reject when Knock doesn't answer.
   */
  preferences: {
    get(userId: string): Promise<NotificationPreferences>;
    /** Changes only the channels in `changes`, leaving the rest as they are. */
    set(userId: string, changes: NotificationPreferences): Promise<void>;
  };
};
