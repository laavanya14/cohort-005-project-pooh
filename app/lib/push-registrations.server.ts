import { and, eq, lt } from "drizzle-orm";
import { db } from "~/db";
import type { DbExecutor } from "~/db/executor";
import { pushRegistrations } from "~/db/schema";
import {
  enqueueNotificationJob,
  sendNotificationJobsSoon,
} from "~/lib/notifications/outbox.server";
import type { BrowserPushRegistration } from "~/lib/notifications/push-upkeep";

// Push registrations: the browsers each person turned on push in. Cadence's
// table is the source of truth (docs/adr/0014). Every change queues a sync
// that writes the person's whole token list to Knock; the outbox keeps at
// most one waiting per person and reads the list when it sends.

/** Queues a write of the person's whole token list to Knock. */
function syncPushTokens(tx: DbExecutor, userId: number) {
  enqueueNotificationJob(tx, { type: "setPushTokens", userId });
}

/**
 * Saves the token a browser got from Firebase for the person signed in to
 * it, and returns the registration's id for the session to hold.
 * `registrationId` is the one the session already holds, if any: when this
 * browser's token changed, its registration is updated rather than added.
 * A token already registered to someone else moves to this person, since
 * one browser pushes to one person.
 */
export function savePushRegistration(
  {
    userId,
    token,
    userAgent,
    registrationId,
    now = new Date(),
  }: {
    userId: number;
    token: string;
    /** The browser's User-Agent header, for its short label. */
    userAgent: string | null;
    registrationId: number | null;
    now?: Date;
  },
  executor: DbExecutor = db
): number {
  const seenAt = now.toISOString();
  const browserLabel = browserLabelFor(userAgent);

  const id = executor.transaction((tx) => {
    const sameToken = tx
      .select()
      .from(pushRegistrations)
      .where(eq(pushRegistrations.token, token))
      .get();
    const sessions =
      registrationId === null
        ? undefined
        : tx
            .select()
            .from(pushRegistrations)
            .where(
              and(
                eq(pushRegistrations.id, registrationId),
                eq(pushRegistrations.userId, userId)
              )
            )
            .get();

    // The session's registration is stale when this token is already
    // registered on its own row.
    if (sessions && sameToken && sessions.id !== sameToken.id) {
      tx.delete(pushRegistrations)
        .where(eq(pushRegistrations.id, sessions.id))
        .run();
    }

    const existing = sameToken ?? sessions;
    if (!existing) {
      const created = tx
        .insert(pushRegistrations)
        .values({
          userId,
          token,
          browserLabel,
          createdAt: seenAt,
          lastSeenAt: seenAt,
        })
        .returning({ id: pushRegistrations.id })
        .get();
      syncPushTokens(tx, userId);
      return created.id;
    }

    tx.update(pushRegistrations)
      .set({ userId, token, browserLabel, lastSeenAt: seenAt })
      .where(eq(pushRegistrations.id, existing.id))
      .run();
    if (existing.userId !== userId) syncPushTokens(tx, existing.userId);
    syncPushTokens(tx, userId);
    return existing.id;
  });

  sendNotificationJobsSoon();
  return id;
}

/**
 * Removes one browser's registration for the person, when they sign out of
 * it or are switched away from in the DevUI. Their other browsers keep
 * theirs. Does nothing when it isn't theirs or is already gone.
 */
export function removePushRegistration(
  { userId, registrationId }: { userId: number; registrationId: number },
  executor: DbExecutor = db
) {
  executor.transaction((tx) => {
    const removed = tx
      .delete(pushRegistrations)
      .where(
        and(
          eq(pushRegistrations.id, registrationId),
          eq(pushRegistrations.userId, userId)
        )
      )
      .run();
    if (removed.changes > 0) syncPushTokens(tx, userId);
  });
  sendNotificationJobsSoon();
}

/** How long a browser can go unseen before its registration is dropped. */
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Deletes the registrations of browsers not seen for 30 days (a browser is
 * seen when it registers or refreshes its token), and queues a sync of each
 * affected person's token list.
 */
export function prunePushRegistrations(
  { now = new Date() }: { now?: Date } = {},
  executor: DbExecutor = db
) {
  const cutoff = new Date(now.getTime() - PRUNE_AFTER_MS).toISOString();

  executor.transaction((tx) => {
    const pruned = tx
      .delete(pushRegistrations)
      .where(lt(pushRegistrations.lastSeenAt, cutoff))
      .returning({ userId: pushRegistrations.userId })
      .all();
    for (const userId of new Set(pruned.map((row) => row.userId))) {
      syncPushTokens(tx, userId);
    }
  });
  sendNotificationJobsSoon();
}

/** How often the server process prunes registrations. */
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Kept on globalThis so a dev-server reload replaces the timer rather than
// starting a second one.
const pruningGlobal = globalThis as typeof globalThis & {
  __cadencePushRegistrationPruning?: () => void;
};

/**
 * Prunes registrations not seen for 30 days now and then once a day, from
 * this server process. Returns a function that stops it.
 */
export function startPushRegistrationPruning() {
  pruningGlobal.__cadencePushRegistrationPruning?.();

  function prune() {
    try {
      prunePushRegistrations();
    } catch (error) {
      console.error("[notifications] Couldn't prune push registrations:", error);
    }
  }

  prune();
  const timer = setInterval(prune, PRUNE_INTERVAL_MS);
  const stop = () => {
    clearInterval(timer);
    if (pruningGlobal.__cadencePushRegistrationPruning === stop) {
      pruningGlobal.__cadencePushRegistrationPruning = undefined;
    }
  };
  pruningGlobal.__cadencePushRegistrationPruning = stop;
  return stop;
}

/**
 * This browser's registration (from the session), if it's the person's: its
 * token and when it was last seen, for the browser's refresh on app load.
 */
export function pushRegistrationHere(
  { userId, registrationId }: { userId: number; registrationId: number | null },
  executor: DbExecutor = db
): BrowserPushRegistration | null {
  if (registrationId === null) return null;

  return (
    executor
      .select({
        token: pushRegistrations.token,
        lastSeenAt: pushRegistrations.lastSeenAt,
      })
      .from(pushRegistrations)
      .where(
        and(
          eq(pushRegistrations.id, registrationId),
          eq(pushRegistrations.userId, userId)
        )
      )
      .get() ?? null
  );
}

/** Whether this browser's registration (from the session) is the person's. */
export function isRegisteredForPush(
  { userId, registrationId }: { userId: number; registrationId: number | null },
  executor: DbExecutor = db
) {
  if (registrationId === null) return false;

  return !!executor
    .select({ id: pushRegistrations.id })
    .from(pushRegistrations)
    .where(
      and(
        eq(pushRegistrations.id, registrationId),
        eq(pushRegistrations.userId, userId)
      )
    )
    .get();
}

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
];

/** A short name for a browser from its User-Agent, such as "Chrome on macOS". */
export function browserLabelFor(userAgent: string | null) {
  const ua = userAgent ?? "";
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1];

  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "A browser";
}
