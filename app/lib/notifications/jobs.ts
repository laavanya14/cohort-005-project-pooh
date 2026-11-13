import type { NotificationTransport, TriggerRequest } from "./transport";

// The kinds of job the notification outbox holds. Each is one call to the
// Knock-facing interface. To add one, add a member to `NotificationJob` and a
// case to `performJob`; the compiler points at anything else that's missing.

export type NotificationJob = {
  type: "trigger";
  workflowKey: string;
  request: TriggerRequest;
};

/** A short description of the job for the server log. */
export function describeJob(job: NotificationJob) {
  switch (job.type) {
    case "trigger":
      return `the ${job.workflowKey} trigger`;
  }
}

/** Makes the job's call. Rejects when Knock doesn't accept it. */
export function performJob(
  transport: NotificationTransport,
  job: NotificationJob,
  idempotencyKey: string
): Promise<void> {
  switch (job.type) {
    case "trigger":
      return transport.trigger(job.workflowKey, job.request, {
        idempotencyKey,
      });
  }
}
