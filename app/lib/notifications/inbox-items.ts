import type { FeedItem } from "@knocklabs/client";
import { splitInboxBody } from "./inbox-copy";

// What the Inbox shows for each notification, read from Knock's feed items.
// Shared by the display-only drawer and the wrapper that feeds it.

/** A notification's kind: the category its Knock workflow is tagged with. */
export type InboxKind = "waiting-on-you" | "about-you" | "activity";

export const INBOX_KINDS: readonly InboxKind[] = [
  "waiting-on-you",
  "about-you",
  "activity",
];

export const inboxKindLabels: Record<InboxKind, string> = {
  "waiting-on-you": "Waiting on you",
  "about-you": "About you",
  activity: "Activity",
};

export type InboxNotification = {
  /** Knock's message id. */
  id: string;
  kind: InboxKind;
  headline: string;
  /** The quoted detail line. Empty when the notification has none. */
  detail: string;
  /** What it's about: a course, lesson or team. */
  context: string | null;
  /** ISO timestamp. */
  insertedAt: string;
  read: boolean;
  archived: boolean;
  /** Its workflow also sends a browser push. */
  sentByPush: boolean;
  /** The page it opens. */
  path: string;
};

function isInboxKind(category: string): category is InboxKind {
  return (INBOX_KINDS as readonly string[]).includes(category);
}

function text(data: Record<string, unknown>, key: string) {
  const value = data[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** "Generics · Intro to TypeScript", "Intro to TypeScript", or a team name. */
function contextOf(data: Record<string, unknown>) {
  const parts = [
    text(data, "lessonTitle"),
    text(data, "courseTitle"),
    text(data, "teamName"),
  ].filter((part) => part !== null);

  return parts.length > 0 ? parts.join(" · ") : null;
}

function bodyOf(item: FeedItem) {
  const block = item.blocks.find(
    (b) => b.name === "body" && b.type !== "button_set"
  );
  return block && block.type !== "button_set" ? block.content : "";
}

export function toInboxNotification(
  item: FeedItem,
  workflowsWithPush: ReadonlySet<string>
): InboxNotification {
  const data: Record<string, unknown> = item.data ?? {};
  const { headline, detail } = splitInboxBody(bodyOf(item));

  return {
    id: item.id,
    kind: item.source.categories.find(isInboxKind) ?? "activity",
    headline,
    detail,
    context: contextOf(data),
    insertedAt: item.inserted_at,
    read: item.read_at !== null,
    archived: item.archived_at !== null,
    sentByPush: workflowsWithPush.has(item.source.key),
    path: text(data, "path") ?? "/",
  };
}

/** The parts of a `knock/workflows/<key>/workflow.json` the inbox reads. */
export type KnockWorkflowFile = {
  key: string;
  steps: {
    type: string;
    channel_key?: string;
    template?: { settings?: object };
  }[];
};

/**
 * The workflows that also send a browser push. A push template is the only
 * kind with a `delivery_type` setting, whatever its channel is called.
 */
export function workflowsSentByPush(
  workflows: KnockWorkflowFile[]
): Set<string> {
  return new Set(
    workflows
      .filter((workflow) =>
        workflow.steps.some(
          (step) =>
            step.type === "channel" &&
            step.template?.settings !== undefined &&
            "delivery_type" in step.template.settings
        )
      )
      .map((workflow) => workflow.key)
  );
}

/** Read from the workflows kept in `knock/` when the app is built. */
export const WORKFLOWS_SENT_BY_PUSH = workflowsSentByPush(
  Object.values(
    import.meta.glob<KnockWorkflowFile>("/knock/workflows/*/workflow.json", {
      eager: true,
      import: "default",
    })
  )
);
