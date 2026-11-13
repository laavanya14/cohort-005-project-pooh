import type {
  InAppMessageSelector,
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

/**
 * An in-memory stand-in for Knock. It records every trigger it accepts in
 * `triggers`, every bulk archive in `archives`, and both in `calls`, in the
 * order it accepted them. `attempts` holds every trigger it was asked for,
 * accepted or not. `failNext()` makes the next calls of any kind fail, as if
 * Knock were down.
 */
export function createRecordingTransport() {
  const triggers: RecordedTrigger[] = [];
  const attempts: RecordedTrigger[] = [];
  const archives: InAppMessageSelector[] = [];
  const calls: RecordedCall[] = [];
  let failuresLeft = 0;

  function knockIsDown() {
    if (failuresLeft <= 0) return false;
    failuresLeft -= 1;
    return true;
  }

  const transport: NotificationTransport & {
    triggers: RecordedTrigger[];
    attempts: RecordedTrigger[];
    archives: InAppMessageSelector[];
    calls: RecordedCall[];
    failNext(times?: number): void;
  } = {
    triggers,
    attempts,
    archives,
    calls,
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
  };

  return transport;
}
