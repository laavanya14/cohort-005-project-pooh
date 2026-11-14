import { eq } from "drizzle-orm";
import { data } from "react-router";
import { db } from "~/db";
import { users, UserRole } from "~/db/schema";
import type { WorkflowKey } from "./notify.server";
import type { WORKFLOW_CHANNELS } from "./preference-defaults";
import type {
  NotificationChannelType,
  NotificationTransport,
} from "./transport";

// Settings → Notifications: one row per event a person can receive by push
// or email, with a switch for each of those channels. Inbox-only events have
// no row. There are no master switches and no per-device switch: Knock holds
// one set of preferences per person, used on every device.
//
// Preferences are read from and written to Knock straight away, not through
// the notification outbox, so the page always shows what Knock will use and
// a failed save is reported to the person rather than retried behind them.

type PreferenceWorkflowKey = keyof typeof WORKFLOW_CHANNELS;

type PreferenceRowDefinition = {
  workflowKey: PreferenceWorkflowKey;
  label: string;
  /** The switches shown. A channel left out can't be changed here. */
  channels: readonly NotificationChannelType[];
};

/**
 * Workflows whose email a buyer always gets, because they are about money.
 * Their Email switch isn't shown, and a change turning it off is refused.
 * Issued refund and failed refund arrive with payout tracking; they're listed
 * already so the rule holds the day they do.
 */
const EMAIL_ALWAYS_ON = new Set<string>([
  "refund-request-decided",
  "issued-refund",
  "failed-refund",
]);

const ROWS_BY_ROLE: Record<UserRole, PreferenceRowDefinition[]> = {
  [UserRole.Student]: [
    {
      workflowKey: "refund-request-decided",
      label: "Refund request decided",
      channels: ["push"],
    },
    {
      workflowKey: "instructor-or-platform-admin-reply",
      label: "A reply from the instructor or a platform admin",
      channels: ["push", "email"],
    },
  ],
  [UserRole.Instructor]: [
    {
      workflowKey: "student-top-level-comment",
      label: "A student's question",
      channels: ["push", "email"],
    },
    {
      workflowKey: "instructor-or-platform-admin-reply",
      label: "A reply from a platform admin",
      channels: ["push", "email"],
    },
  ],
  [UserRole.PlatformAdmin]: [
    {
      workflowKey: "new-open-refund-request",
      label: "New open refund request",
      channels: ["push"],
    },
    {
      workflowKey: "instructor-or-platform-admin-reply",
      label: "A reply from the instructor or a platform admin",
      channels: ["push", "email"],
    },
  ],
};

export type NotificationPreferenceRow = {
  workflowKey: WorkflowKey;
  label: string;
  /** One switch per channel shown, and whether it is on. */
  switches: Partial<Record<NotificationChannelType, boolean>>;
};

export type NotificationPreferenceChange = {
  /** Unchecked: it comes from a form. */
  workflowKey: string;
  channel: NotificationChannelType;
  on: boolean;
};

function rowsFor(userId: number) {
  const user = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user) throw data("User not found.", { status: 404 });

  return ROWS_BY_ROLE[user.role];
}

/** The person's Notifications rows, with each switch as Knock holds it. */
export async function listNotificationPreferences(
  transport: NotificationTransport,
  userId: number
): Promise<NotificationPreferenceRow[]> {
  const rows = rowsFor(userId);
  const preferences = await transport.preferences.get(String(userId));

  return rows.map(({ workflowKey, label, channels }) => ({
    workflowKey,
    label,
    switches: Object.fromEntries(
      // A channel Knock has no value for is on.
      channels.map((channel) => [
        channel,
        preferences[workflowKey]?.[channel] ?? true,
      ])
    ),
  }));
}

/**
 * Turns one of the person's switches on or off. Throws a 400 for an email
 * that can't be turned off, or a switch the person doesn't have.
 */
export async function setNotificationPreference(
  transport: NotificationTransport,
  userId: number,
  { workflowKey, channel, on }: NotificationPreferenceChange
) {
  if (channel === "email" && !on && EMAIL_ALWAYS_ON.has(workflowKey)) {
    throw data(
      "Email about a refund request or a refund can't be turned off.",
      { status: 400 }
    );
  }

  const row = rowsFor(userId).find((r) => r.workflowKey === workflowKey);
  if (!row || !row.channels.includes(channel)) {
    throw data("You can't change that notification preference.", {
      status: 400,
    });
  }

  await transport.preferences.set(String(userId), {
    [workflowKey]: { [channel]: on },
  });
}
