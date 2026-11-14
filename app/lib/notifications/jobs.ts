import type {
  InAppMessageSelector,
  NotificationTransport,
  TriggerRequest,
} from "./transport";

// The kinds of job the notification outbox holds. Each is one call to the
// Knock-facing interface. To add one, add a member to `NotificationJob` and a
// case to `performJob`; the compiler points at anything else that's missing.

export type NotificationJob =
  | {
      type: "trigger";
      workflowKey: string;
      request: TriggerRequest;
    }
  | {
      type: "bulkArchive";
      selector: InAppMessageSelector;
    }
  | {
      /**
       * Writes the person's whole list of push tokens to Knock. The list is
       * read from the push registrations table when the job is sent, not
       * when it's saved, so one waiting job covers every change before it:
       * the outbox keeps at most one waiting per person.
       */
      type: "setPushTokens";
      userId: number;
    };

/** What a job reads from Cadence's database when it is sent. */
export type JobSources = {
  /** The person's push tokens, as the push registrations table has them now. */
  pushTokensOf(userId: number): string[];
};

/** A short description of the job for the server log. */
export function describeJob(job: NotificationJob) {
  switch (job.type) {
    case "trigger":
      return `the ${job.workflowKey} trigger`;
    case "bulkArchive":
      return `the bulk archive of ${job.selector.workflowKey} by ${job.selector.key} ${job.selector.value}`;
    case "setPushTokens":
      return `the push tokens of person ${job.userId}`;
  }
}

/** Makes the job's call. Rejects when Knock doesn't accept it. */
export function performJob(
  transport: NotificationTransport,
  job: NotificationJob,
  idempotencyKey: string,
  sources: JobSources
): Promise<void> {
  switch (job.type) {
    case "trigger":
      return transport.trigger(job.workflowKey, job.request, {
        idempotencyKey,
      });
    case "bulkArchive":
      return transport.bulkArchive(job.selector);
    case "setPushTokens":
      return transport.setPushTokens(
        String(job.userId),
        sources.pushTokensOf(job.userId)
      );
  }
}
