import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  defaultNotificationPreferences,
  mergeNotificationPreferences,
} from "./preference-defaults";
import type {
  NotificationPreferences,
  NotificationTransport,
} from "./transport";

// The Knock-facing interface for local dev without KNOCK_SECRET_KEY. It
// writes what would have been sent to files under .outbox/, so a developer
// can see it. It doesn't apply preferences or work out channels: that's
// Knock's job. It does keep each person's preferences, so Settings works.

export const OUTBOX_DIR = ".outbox";

/** Milliseconds since the epoch, never the same twice in this process. */
let lastStamp = 0;
function uniqueTimestamp() {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  // Colons aren't allowed in file names on every system.
  return new Date(lastStamp).toISOString().replace(/[:.]/g, "-");
}

async function writeJson(dir: string, name: string, contents: unknown) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${uniqueTimestamp()}-${name}.json`);
  await writeFile(file, `${JSON.stringify(contents, null, 2)}\n`);
}

export function createFileTransport({
  notificationsDir = path.join(OUTBOX_DIR, "notifications"),
  archivesDir = path.join(OUTBOX_DIR, "bulk-archives"),
  preferencesDir = path.join(OUTBOX_DIR, "notification-preferences"),
  pushTokensDir = path.join(OUTBOX_DIR, "push-tokens"),
}: {
  notificationsDir?: string;
  archivesDir?: string;
  preferencesDir?: string;
  pushTokensDir?: string;
} = {}): NotificationTransport {
  function preferencesFile(userId: string) {
    return path.join(preferencesDir, `${encodeURIComponent(userId)}.json`);
  }

  /** The person's saved preferences, or the defaults before their first change. */
  async function readPreferences(
    userId: string
  ): Promise<NotificationPreferences> {
    try {
      const saved: NotificationPreferences = JSON.parse(
        await readFile(preferencesFile(userId), "utf8")
      );
      return saved;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return defaultNotificationPreferences();
      }
      throw error;
    }
  }

  return {
    async trigger(workflowKey, request, { idempotencyKey }) {
      await writeJson(notificationsDir, workflowKey, {
        workflowKey,
        idempotencyKey,
        ...request,
      });
    },

    async bulkArchive(selector) {
      await writeJson(archivesDir, selector.workflowKey, selector);
    },

    // One file per person, holding their whole list, as Knock does. An
    // empty list unsets it, so the file goes.
    async setPushTokens(userId, tokens) {
      const file = path.join(pushTokensDir, `${encodeURIComponent(userId)}.json`);
      if (tokens.length === 0) {
        await rm(file, { force: true });
        return;
      }
      await mkdir(pushTokensDir, { recursive: true });
      await writeFile(file, `${JSON.stringify({ tokens }, null, 2)}\n`);
    },

    preferences: {
      get: readPreferences,

      async set(userId, changes) {
        const preferences = mergeNotificationPreferences(
          await readPreferences(userId),
          changes
        );
        await mkdir(preferencesDir, { recursive: true });
        await writeFile(
          preferencesFile(userId),
          `${JSON.stringify(preferences, null, 2)}\n`
        );
      },
    },
  };
}
