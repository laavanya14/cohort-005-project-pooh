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

  it("keeps each person's whole push token list in one file, and removes it when the list is empty", async () => {
    const pushTokensDir = path.join(outboxDir(), "push-tokens");
    const transport = createFileTransport({ pushTokensDir });

    await transport.setPushTokens("7", ["laptop-token"]);
    await transport.setPushTokens("7", ["laptop-token", "phone-token"]);

    expect(readdirSync(pushTokensDir)).toEqual(["7.json"]);
    expect(
      JSON.parse(readFileSync(path.join(pushTokensDir, "7.json"), "utf8"))
    ).toEqual({ tokens: ["laptop-token", "phone-token"] });

    await transport.setPushTokens("7", []);
    expect(readdirSync(pushTokensDir)).toEqual([]);
  });

  it("writes one JSON file per bulk archive, named by time and workflow key", async () => {
    const archivesDir = path.join(outboxDir(), "bulk-archives");
    const transport = createFileTransport({ archivesDir });

    await transport.bulkArchive({
      workflowKey: "new-open-refund-request",
      key: "refundRequestId",
      value: 7,
    });

    const files = readdirSync(archivesDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T[\d-]+Z-new-open-refund-request\.json$/
    );
    expect(
      JSON.parse(readFileSync(path.join(archivesDir, files[0]), "utf8"))
    ).toEqual({
      workflowKey: "new-open-refund-request",
      key: "refundRequestId",
      value: 7,
    });
  });

  it("starts each person's notification preferences with every channel on", async () => {
    const transport = createFileTransport({
      preferencesDir: path.join(outboxDir(), "notification-preferences"),
    });

    expect(await transport.preferences.get("12")).toEqual({
      "refund-request-decided": { push: true, email: true },
      "instructor-or-platform-admin-reply": { push: true, email: true },
      "student-top-level-comment": { push: true, email: true },
      "new-open-refund-request": { push: true },
    });
  });

  it("saves a person's notification preferences to <userId>.json, keeping earlier changes", async () => {
    const preferencesDir = path.join(outboxDir(), "notification-preferences");
    const transport = createFileTransport({ preferencesDir });

    await transport.preferences.set("12", {
      "instructor-or-platform-admin-reply": { email: false },
    });
    await transport.preferences.set("12", {
      "refund-request-decided": { push: false },
    });

    const saved = {
      "refund-request-decided": { push: false, email: true },
      "instructor-or-platform-admin-reply": { push: true, email: false },
      "student-top-level-comment": { push: true, email: true },
      "new-open-refund-request": { push: true },
    };
    expect(readdirSync(preferencesDir)).toEqual(["12.json"]);
    expect(
      JSON.parse(readFileSync(path.join(preferencesDir, "12.json"), "utf8"))
    ).toEqual(saved);
    expect(await transport.preferences.get("12")).toEqual(saved);
    expect(
      await createFileTransport({ preferencesDir }).preferences.get("13")
    ).toEqual(expect.objectContaining({ "new-open-refund-request": { push: true } }));
  });
});
