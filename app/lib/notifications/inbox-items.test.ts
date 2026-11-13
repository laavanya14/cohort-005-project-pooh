import { describe, expect, it } from "vitest";
import type { FeedItem } from "@knocklabs/client";
import { toInboxNotification, workflowsSentByPush } from "./inbox-items";

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    __cursor: "c-1",
    id: "msg-1",
    actors: [],
    total_actors: 0,
    blocks: [
      {
        name: "body",
        type: "markdown",
        content: "Refund request declined\n\nIntro to TypeScript · “Too late”",
        rendered: "<p>Refund request declined</p>",
      },
    ],
    data: {
      notificationId: "n-1",
      path: "/courses/intro-to-typescript",
      courseTitle: "Intro to TypeScript",
    },
    inserted_at: "2026-11-13T11:55:00Z",
    updated_at: "2026-11-13T11:55:00Z",
    read_at: null,
    seen_at: null,
    clicked_at: null,
    interacted_at: null,
    link_clicked_at: null,
    archived_at: null,
    source: {
      key: "refund-request-decided",
      version_id: "v-1",
      categories: ["about-you"],
    },
    tenant: null,
    ...overrides,
  };
}

const noPush = new Set<string>();

describe("toInboxNotification", () => {
  it("shows the headline and detail line from the in-app body", () => {
    const n = toInboxNotification(feedItem(), noPush);

    expect(n.headline).toBe("Refund request declined");
    expect(n.detail).toBe("Intro to TypeScript · “Too late”");
  });

  it("takes its kind from the workflow's category, its page from the trigger data", () => {
    const n = toInboxNotification(
      feedItem({
        source: {
          key: "new-open-refund-request",
          version_id: "v-1",
          categories: ["waiting-on-you"],
        },
        data: { path: "/admin/refund-requests" },
      }),
      noPush
    );

    expect(n.kind).toBe("waiting-on-you");
    expect(n.path).toBe("/admin/refund-requests");
  });

  it("shows a notification with no known kind under Activity", () => {
    const n = toInboxNotification(
      feedItem({
        source: { key: "something-new", version_id: "v-1", categories: [] },
      }),
      noPush
    );

    expect(n.kind).toBe("activity");
  });

  it("says what it's about: the lesson and course, the course, or the team", () => {
    const about = (data: Record<string, unknown>) =>
      toInboxNotification(feedItem({ data: { path: "/", ...data } }), noPush)
        .context;

    expect(about({ lessonTitle: "Generics", courseTitle: "TypeScript" })).toBe(
      "Generics · TypeScript"
    );
    expect(about({ courseTitle: "TypeScript" })).toBe("TypeScript");
    expect(about({ teamName: "Acme" })).toBe("Acme");
    expect(about({})).toBeNull();
  });

  it("is read and archived when Knock says so", () => {
    const fresh = toInboxNotification(feedItem(), noPush);
    const handled = toInboxNotification(
      feedItem({
        read_at: "2026-11-13T11:56:00Z",
        archived_at: "2026-11-13T11:57:00Z",
      }),
      noPush
    );

    expect([fresh.read, fresh.archived]).toEqual([false, false]);
    expect([handled.read, handled.archived]).toEqual([true, true]);
  });

  it("shows the push marker only for workflows that also send a push", () => {
    const pushed = new Set(["refund-request-decided"]);

    expect(toInboxNotification(feedItem(), pushed).sentByPush).toBe(true);
    expect(toInboxNotification(feedItem(), noPush).sentByPush).toBe(false);
  });
});

describe("workflowsSentByPush", () => {
  it("finds the workflows with a push step", () => {
    const keys = workflowsSentByPush([
      {
        key: "refund-request-decided",
        steps: [
          { type: "channel", channel_key: "in-app", template: {} },
          {
            type: "channel",
            channel_key: "fcm",
            template: { settings: { delivery_type: "content" } },
          },
        ],
      },
      {
        key: "seat-claimed",
        steps: [{ type: "channel", channel_key: "in-app", template: {} }],
      },
      {
        key: "new-enrollment",
        steps: [
          { type: "batch" },
          { type: "channel", channel_key: "in-app", template: {} },
        ],
      },
    ]);

    expect([...keys]).toEqual(["refund-request-decided"]);
  });
});
