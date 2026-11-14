import type { WorkflowKey } from "./notify.server";
import type {
  NotificationChannelType,
  NotificationPreferences,
} from "./transport";

/**
 * The push and email channels of each workflow that has any. Every other
 * workflow is inbox only, so it has no notification preference. Knock's
 * environment default preference set turns each of these on (see
 * knock/README.md), and so does every fake.
 */
export const WORKFLOW_CHANNELS = {
  "refund-request-decided": ["push", "email"],
  "instructor-or-platform-admin-reply": ["push", "email"],
  "student-top-level-comment": ["push", "email"],
  "new-open-refund-request": ["push"],
} as const satisfies Partial<
  Record<WorkflowKey, readonly NotificationChannelType[]>
>;

/** Every channel in `WORKFLOW_CHANNELS` on: what a person starts with. */
export function defaultNotificationPreferences(): NotificationPreferences {
  return Object.fromEntries(
    Object.entries(WORKFLOW_CHANNELS).map(([workflowKey, channels]) => [
      workflowKey,
      Object.fromEntries(channels.map((channel) => [channel, true])),
    ])
  );
}

/** `changes` laid over `preferences`, one channel at a time. */
export function mergeNotificationPreferences(
  preferences: NotificationPreferences,
  changes: NotificationPreferences
): NotificationPreferences {
  const merged: NotificationPreferences = { ...preferences };
  for (const [workflowKey, channels] of Object.entries(changes)) {
    merged[workflowKey] = { ...merged[workflowKey], ...channels };
  }
  return merged;
}
