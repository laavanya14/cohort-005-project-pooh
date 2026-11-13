import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readNotificationConfig } from "./config.server";
import { splitInboxBody } from "./inbox-copy";
import { createKnockTransport } from "./knock-transport.server";

// Runs only with `npm run test:knock` and Knock *development* keys (in the
// shell or .env). It sends a real workflow to a test user in Knock's
// development environment and reads the result back from that user's inbox.
// Push the templates first: `npx @knocklabs/cli push` (see knock/README.md).

const KNOCK_API = "https://api.knock.app";
const testUser = {
  id: "cadence-test-knock-user",
  name: "Cadence Test Buyer",
  email: "knock-test@example.com",
};
const testReviewer = {
  id: "cadence-test-knock-reviewer",
  name: "Cadence Test Reviewer",
  email: "knock-test-reviewer@example.com",
};

type FeedItem = {
  data: Record<string, unknown> | null;
  source: { key: string; categories: string[] };
  blocks: { name: string; type: string; content?: string }[];
};

const { knock } = readNotificationConfig();

async function inboxItems(secretKey: string, channelId: string) {
  const response = await fetch(
    `${KNOCK_API}/v1/users/${testUser.id}/feeds/${channelId}?page_size=10`,
    { headers: { Authorization: `Bearer ${secretKey}` } }
  );
  expect(response.ok).toBe(true);
  const { entries } = (await response.json()) as { entries: FeedItem[] };
  return entries;
}

describe.skipIf(!knock)("Knock's development environment", () => {
  it("puts a decided refund request in the buyer's inbox, with its headline and detail line", async () => {
    if (!knock) return;
    const transport = createKnockTransport({ secretKey: knock.secretKey });
    const notificationId = randomUUID();

    await transport.trigger(
      "refund-request-decided",
      {
        recipients: [testUser],
        actor: testReviewer,
        data: {
          outcome: "approved",
          courseTitle: "Intro to Testing",
          decisionNote: "Within the refund window.",
          notificationId,
          path: "/courses/intro-to-testing",
        },
      },
      { idempotencyKey: notificationId }
    );

    // Knock runs workflows asynchronously, so wait for the item to arrive.
    let item: FeedItem | undefined;
    for (let attempt = 0; attempt < 20 && !item; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const items = await inboxItems(knock.secretKey, knock.inAppChannelId);
      item = items.find((i) => i.data?.notificationId === notificationId);
    }

    expect(item?.source.key).toBe("refund-request-decided");
    expect(item?.source.categories).toContain("about-you");
    expect(item?.data?.path).toBe("/courses/intro-to-testing");

    const body = item?.blocks.find((block) => block.name === "body");
    expect(splitInboxBody(body?.content ?? "")).toEqual({
      headline: "We approved your refund request",
      detail: 'Intro to Testing · "Within the refund window."',
    });
  });
});
