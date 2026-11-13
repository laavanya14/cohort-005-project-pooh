import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NotificationTransport } from "./transport";

// The Knock-facing interface for local dev without KNOCK_SECRET_KEY. It
// writes what would have been sent to files under .outbox/, so a developer
// can see it. It doesn't apply preferences or work out channels: that's
// Knock's job.

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
}: { notificationsDir?: string; archivesDir?: string } = {}): NotificationTransport {
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
  };
}
