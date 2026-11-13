import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileTransport } from "./file-transport.server";

const buyer = { id: "1", name: "Buyer", email: "buyer@example.com" };
const reviewer = { id: "2", name: "Reviewer", email: "reviewer@example.com" };

let dir: string | undefined;

function outboxDir() {
  dir = mkdtempSync(path.join(tmpdir(), "cadence-outbox-"));
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("the file-writing notification fake", () => {
  it("writes one JSON file per trigger, named by time and workflow key", async () => {
    const notificationsDir = path.join(outboxDir(), "notifications");
    const transport = createFileTransport({ notificationsDir });

    await transport.trigger(
      "refund-request-decided",
      {
        recipients: [buyer],
        actor: reviewer,
        data: { outcome: "declined", path: "/courses/test-course" },
      },
      { idempotencyKey: "first" }
    );
    await transport.trigger(
      "refund-request-decided",
      { recipients: [buyer], actor: reviewer, data: { outcome: "approved" } },
      { idempotencyKey: "second" }
    );

    const files = readdirSync(notificationsDir).sort();
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(file).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-refund-request-decided\.json$/);
    }

    const [first] = files.map((file) =>
      JSON.parse(readFileSync(path.join(notificationsDir, file), "utf8"))
    );
    expect(first).toEqual({
      workflowKey: "refund-request-decided",
      idempotencyKey: "first",
      recipients: [buyer],
      actor: reviewer,
      data: { outcome: "declined", path: "/courses/test-course" },
    });
  });
});
