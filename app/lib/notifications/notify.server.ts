import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { users } from "~/db/schema";
import type { DbExecutor } from "~/db/executor";
import {
  enqueueNotificationJob,
  sendNotificationJobsSoon,
} from "./outbox.server";
import type { NotificationRecipient } from "./transport";

// The typed layer every notification goes through. Each event is keyed by
// its Knock workflow key and has its own data type, so the compiler rejects a
// wrong payload. To add an event, add its workflow key and data here, then
// call `notify` from the one shared function where the event happens.

/** The data each workflow's templates get, beyond `notificationId` and `path`. */
export type WorkflowData = {
  "refund-request-decided": {
    outcome: "approved" | "declined";
    courseTitle: string;
    decisionNote: string | null;
  };
  "new-enrollment": {
    /** Knock batches each instructor's notifications per course on this. */
    courseId: number;
    courseTitle: string;
    studentName: string;
  };
  "new-or-changed-rating": {
    /** Knock batches each instructor's notifications per course on this. */
    courseId: number;
    courseTitle: string;
    studentName: string;
    /** The student's new star rating, 1–5. */
    rating: number;
  };
  /** Never carries the buyer's reason: that stays with the reviewers. */
  "enrollment-ended": {
    /** Knock batches each instructor's notifications per course on this. */
    courseId: number;
    courseTitle: string;
    studentName: string;
  };
};

export type WorkflowKey = keyof WorkflowData;

/** Who gets a notification, worked out when it is triggered. */
export type RecipientQuery = { userIds: number[] };

export type NotificationEvent = {
  [K in WorkflowKey]: {
    workflowKey: K;
    /** The person whose action caused it. They never get it themselves. */
    actorId: number;
    recipients: RecipientQuery;
    /** The page the notification opens. */
    path: string;
    data: WorkflowData[K];
  };
}[WorkflowKey];

/** What every workflow's trigger data carries. */
export type TriggerData<K extends WorkflowKey> = WorkflowData[K] & {
  /** Unique per notification. Also the idempotency key and the push tag. */
  notificationId: string;
  path: string;
};

/**
 * Every field each workflow's trigger data carries, at runtime, so a test
 * can check the Knock templates read only these (knock-templates.test.ts).
 * The compiler keeps it equal to `TriggerData`: a field missing here, or one
 * that isn't in the type, is an error. Add one entry per workflow.
 */
export const TRIGGER_DATA_FIELDS = {
  "refund-request-decided": {
    outcome: true,
    courseTitle: true,
    decisionNote: true,
    notificationId: true,
    path: true,
  },
  "new-enrollment": {
    courseId: true,
    courseTitle: true,
    studentName: true,
    notificationId: true,
    path: true,
  },
  "new-or-changed-rating": {
    courseId: true,
    courseTitle: true,
    studentName: true,
    rating: true,
    notificationId: true,
    path: true,
  },
  "enrollment-ended": {
    courseId: true,
    courseTitle: true,
    studentName: true,
    notificationId: true,
    path: true,
  },
} as const satisfies {
  [K in WorkflowKey]: Record<keyof TriggerData<K>, true>;
};

function lookUpPeople(tx: DbExecutor, userIds: number[]) {
  if (userIds.length === 0) return [];

  return tx
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, userIds))
    .all();
}

function asRecipient(user: {
  id: number;
  name: string;
  email: string;
}): NotificationRecipient {
  return { id: String(user.id), name: user.name, email: user.email };
}

/**
 * Saves the notification to send. Call it inside the action's transaction,
 * so the notification is sent only if the action commits.
 */
export function notify(tx: DbExecutor, event: NotificationEvent) {
  const recipients = lookUpPeople(tx, event.recipients.userIds)
    .filter((person) => person.id !== event.actorId)
    .map(asRecipient);

  const [actor] = lookUpPeople(tx, [event.actorId]).map(asRecipient);

  if (recipients.length === 0 || !actor) return;

  const notificationId = randomUUID();
  const data: TriggerData<typeof event.workflowKey> = {
    ...event.data,
    notificationId,
    path: event.path,
  };

  enqueueNotificationJob(
    tx,
    {
      type: "trigger",
      workflowKey: event.workflowKey,
      request: { recipients, actor, data },
    },
    notificationId
  );
  sendNotificationJobsSoon();
}
