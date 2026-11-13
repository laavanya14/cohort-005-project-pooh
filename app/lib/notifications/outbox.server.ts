import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "~/db";
import type { DbExecutor } from "~/db/executor";
import { notificationJobs } from "~/db/schema";
import { describeJob, performJob, type NotificationJob } from "./jobs";
import type { NotificationTransport } from "./transport";

// The notification outbox. A job is saved in the same transaction as the
// action that caused it, so an action that rolls back sends nothing. The
// outbox then sends it, deleting it once Knock accepts it. The action never
// waits on Knock and never fails because of it.

/** How long a job Knock didn't accept waits before it is tried again. */
const RETRY_DELAY_MS = 60 * 1000;

/** How long Knock has to accept a job before it is marked failed. */
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Saves a job to send. Call it inside the action's transaction. Returns the
 * job's id, which is also its idempotency key.
 */
export function enqueueNotificationJob(
  tx: DbExecutor,
  job: NotificationJob,
  id: string = randomUUID()
) {
  const now = (
    outboxGlobal.__cadenceNotificationOutbox?.clock() ?? new Date()
  ).toISOString();
  tx.insert(notificationJobs)
    .values({ id, job, createdAt: now, nextRunAt: now })
    .run();
  return id;
}

/**
 * Sends every job that is due, oldest first. Each job that Knock accepts is
 * deleted. One it doesn't is tried again a minute later with the same
 * idempotency key, until 24 hours after it was saved, when it is marked
 * failed and logged.
 */
export async function sendNotificationJobs({
  transport,
  now = new Date(),
}: {
  transport: NotificationTransport;
  now?: Date;
}) {
  const due = db
    .select()
    .from(notificationJobs)
    .where(
      and(
        isNull(notificationJobs.failedAt),
        lte(notificationJobs.nextRunAt, now.toISOString())
      )
    )
    .orderBy(asc(notificationJobs.createdAt), asc(sql`rowid`))
    .all();

  for (const row of due) {
    // An immediate send and the timer can overlap. Only one of them sends.
    if (inFlight.has(row.id)) continue;
    inFlight.add(row.id);

    try {
      await performJob(transport, row.job, row.id);
    } catch (error) {
      const attempts = row.attempts + 1;
      const gaveUp =
        now.getTime() - new Date(row.createdAt).getTime() >= GIVE_UP_AFTER_MS;

      db.update(notificationJobs)
        .set({
          attempts,
          nextRunAt: new Date(now.getTime() + RETRY_DELAY_MS).toISOString(),
          failedAt: gaveUp ? now.toISOString() : null,
        })
        .where(eq(notificationJobs.id, row.id))
        .run();

      if (gaveUp) {
        console.error(
          `[notifications] Knock didn't accept ${describeJob(row.job)} ` +
            `(job ${row.id}) within 24 hours, after ${attempts} attempts. ` +
            `Marked failed. Last error: ${errorMessage(error)}`
        );
      }
      continue;
    } finally {
      inFlight.delete(row.id);
    }

    db.delete(notificationJobs).where(eq(notificationJobs.id, row.id)).run();
  }
}

/** The ids of the jobs being sent right now, in this server process. */
const inFlight = new Set<string>();

/** How often the server process looks for waiting jobs to retry. */
const TIMER_INTERVAL_MS = 30 * 1000;

type RunningOutbox = {
  transport: NotificationTransport;
  clock: () => Date;
  stop: () => void;
};

// Kept on globalThis so a dev-server reload replaces the timer rather than
// starting a second one.
const outboxGlobal = globalThis as typeof globalThis & {
  __cadenceNotificationOutbox?: RunningOutbox;
};

async function sendWaitingJobs(outbox: RunningOutbox) {
  try {
    await sendNotificationJobs({
      transport: outbox.transport,
      now: outbox.clock(),
    });
  } catch (error) {
    console.error(
      `[notifications] Couldn't send the notification outbox: ${errorMessage(error)}`
    );
  }
}

/**
 * Starts sending notifications from this server process: straight after each
 * action commits, and on a timer that retries waiting jobs about once a
 * minute. Returns a function that stops it. Until it is started (in tests and
 * scripts), jobs just wait in the outbox.
 */
export function startNotificationOutbox({
  transport,
  clock = () => new Date(),
}: {
  transport: NotificationTransport;
  clock?: () => Date;
}) {
  outboxGlobal.__cadenceNotificationOutbox?.stop();

  const timer = setInterval(() => void sendWaitingJobs(outbox), TIMER_INTERVAL_MS);
  const outbox: RunningOutbox = {
    transport,
    clock,
    stop() {
      clearInterval(timer);
      if (outboxGlobal.__cadenceNotificationOutbox === outbox) {
        outboxGlobal.__cadenceNotificationOutbox = undefined;
      }
    },
  };
  outboxGlobal.__cadenceNotificationOutbox = outbox;

  return outbox.stop;
}

/**
 * Sends waiting jobs once the current action is over. `notify` calls it from
 * inside the action's transaction; the send runs only after the synchronous
 * transaction has committed or rolled back, so a rolled-back job is never
 * found. The action doesn't wait for it, and a failure never reaches it.
 */
export function sendNotificationJobsSoon() {
  const outbox = outboxGlobal.__cadenceNotificationOutbox;
  if (!outbox) return;

  setImmediate(() => void sendWaitingJobs(outbox));
}
