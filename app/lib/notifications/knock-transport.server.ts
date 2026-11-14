import { z } from "zod";
import type {
  NotificationChannelType,
  NotificationPreferences,
  NotificationTransport,
} from "./transport";

// The real Knock-facing interface. It calls Knock's REST API directly with
// the secret key it is handed, so nothing is ever picked up from the
// environment (the Knock Node SDK would read KNOCK_API_KEY by itself).
//
// Each method is one Knock call made through `callKnock`. To add one, add it
// to `NotificationTransport`, then here, the file fake and the recording
// fake.

const KNOCK_API = "https://api.knock.app";

export type KnockTransportOptions = {
  secretKey: string;
  /** The in-app channel's id (a UUID) in this Knock environment. */
  inAppChannelId: string;
  /** The FCM (browser push) channel's id (a UUID) in this Knock environment. */
  fcmChannelId: string;
  /** Replaced in tests. */
  fetch?: typeof fetch;
  baseUrl?: string;
};

type KnockCall = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  /** Knock honours this only on workflow triggers. */
  idempotencyKey?: string;
  /** A 404 resolves to `null` instead of rejecting. */
  missingIsEmpty?: boolean;
};

const CHANNEL_TYPES: NotificationChannelType[] = ["push", "email"];

/**
 * The part of Knock's preference set Cadence reads: workflow-level
 * preferences. A workflow is `true`/`false` as a whole, or has a setting per
 * channel type, which is a boolean or a set of conditions.
 */
const knockPreferenceSetSchema = z.object({
  workflows: z
    .record(
      z.string(),
      z.union([
        z.boolean(),
        z.object({
          channel_types: z.record(z.string(), z.unknown()).nullish(),
        }),
      ])
    )
    .nullish(),
});

/**
 * Knock's preference set as Cadence's: push and email per workflow. A whole
 * workflow turned off has both off. A channel with conditions, or none, is
 * left out, which reads as on.
 */
function fromKnockPreferences(body: unknown): NotificationPreferences {
  const { workflows } = knockPreferenceSetSchema.parse(body);

  return Object.fromEntries(
    Object.entries(workflows ?? {}).map(([workflowKey, setting]) => {
      if (typeof setting === "boolean") {
        return [
          workflowKey,
          Object.fromEntries(CHANNEL_TYPES.map((type) => [type, setting])),
        ];
      }
      const channelTypes = setting.channel_types ?? {};
      return [
        workflowKey,
        Object.fromEntries(
          CHANNEL_TYPES.flatMap((type) => {
            const value = channelTypes[type];
            return typeof value === "boolean" ? [[type, value]] : [];
          })
        ),
      ];
    })
  );
}

/** Cadence's preference changes as Knock's workflow-level preferences. */
function toKnockWorkflows(changes: NotificationPreferences) {
  return Object.fromEntries(
    Object.entries(changes).map(([workflowKey, channels]) => [
      workflowKey,
      { channel_types: channels },
    ])
  );
}

export function createKnockTransport({
  secretKey,
  inAppChannelId,
  fcmChannelId,
  fetch: fetchKnock = globalThis.fetch,
  baseUrl = KNOCK_API,
}: KnockTransportOptions): NotificationTransport {
  /** Makes one Knock call. Rejects unless Knock answers 2xx. */
  async function callKnock({
    method,
    path,
    body,
    idempotencyKey,
    missingIsEmpty = false,
  }: KnockCall): Promise<Response | null> {
    const headers = new Headers({
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json",
    });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);

    const response = await fetchKnock(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (missingIsEmpty && response.status === 404) return null;
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Knock answered ${response.status} to ${method} ${path}: ${detail}`
      );
    }

    return response;
  }

  return {
    async trigger(workflowKey, { recipients, actor, data }, { idempotencyKey }) {
      await callKnock({
        method: "POST",
        path: `/v1/workflows/${encodeURIComponent(workflowKey)}/trigger`,
        body: { recipients, actor, data },
        idempotencyKey,
      });
    },

    async bulkArchive({ workflowKey, key, value }) {
      await callKnock({
        method: "POST",
        path: `/v1/channels/${encodeURIComponent(inAppChannelId)}/messages/bulk/archive`,
        // Without filters Knock would archive every message in the channel.
        body: {
          trigger_data: JSON.stringify({ [key]: value }),
          workflows: [workflowKey],
        },
      });
    },

    async bulkMarkRead({ recipientId, key, value }) {
      await callKnock({
        method: "POST",
        path: `/v1/channels/${encodeURIComponent(inAppChannelId)}/messages/bulk/read`,
        // Without recipient_ids Knock would mark everyone's copies read.
        body: {
          trigger_data: JSON.stringify({ [key]: value }),
          recipient_ids: [recipientId],
        },
      });
    },

    async setPushTokens(userId, tokens) {
      const path = `/v1/users/${encodeURIComponent(userId)}/channel_data/${encodeURIComponent(fcmChannelId)}`;
      if (tokens.length === 0) {
        // Already unset is as good as unset.
        await callKnock({ method: "DELETE", path, missingIsEmpty: true });
        return;
      }
      // Replaces the list Knock holds, and creates the person if Knock
      // doesn't know them yet.
      await callKnock({ method: "PUT", path, body: { data: { tokens } } });
    },

    preferences: {
      async get(userId) {
        const response = await callKnock({
          method: "GET",
          path: `/v1/users/${encodeURIComponent(userId)}/preferences/default`,
          missingIsEmpty: true,
        });
        // Knock creates a person on their first notification. Until then
        // they have no preferences, so every channel is on.
        if (!response) return {};

        return fromKnockPreferences(await response.json());
      },

      async set(userId, changes) {
        await callKnock({
          method: "PUT",
          path: `/v1/users/${encodeURIComponent(userId)}/preferences/default`,
          body: {
            workflows: toKnockWorkflows(changes),
            // Without it, the PUT replaces every other preference too.
            __persistence_strategy__: "merge",
          },
        });
      },
    },
  };
}
