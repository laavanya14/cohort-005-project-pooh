import type {
  NotificationTransport,
  TriggerRequest,
} from "~/lib/notifications/transport";

export type RecordedTrigger = TriggerRequest & {
  workflowKey: string;
  idempotencyKey: string;
};

/**
 * An in-memory stand-in for Knock. It records every call it accepts in
 * `triggers`, and every call it was asked to make, accepted or not, in
 * `attempts`. `failNext()` makes the next calls fail, as if Knock were down.
 */
export function createRecordingTransport() {
  const triggers: RecordedTrigger[] = [];
  const attempts: RecordedTrigger[] = [];
  let failuresLeft = 0;

  const transport: NotificationTransport & {
    triggers: RecordedTrigger[];
    attempts: RecordedTrigger[];
    failNext(times?: number): void;
  } = {
    triggers,
    attempts,
    failNext(times = 1) {
      failuresLeft = times;
    },
    async trigger(workflowKey, request, { idempotencyKey }) {
      const call = { workflowKey, idempotencyKey, ...request };
      attempts.push(call);
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("Knock is unavailable.");
      }
      triggers.push(call);
    },
  };

  return transport;
}
