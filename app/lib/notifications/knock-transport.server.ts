import type { NotificationTransport } from "./transport";

// The real Knock-facing interface. It calls Knock's REST API directly with
// the secret key it is handed, so nothing is ever picked up from the
// environment (the Knock Node SDK would read KNOCK_API_KEY by itself).
//
// Each method is one Knock call made through `callKnock`. To add one (bulk
// mark read, setPushTokens, preferences), add it to `NotificationTransport`,
// then here, the file fake and the recording fake.

const KNOCK_API = "https://api.knock.app";

export type KnockTransportOptions = {
  secretKey: string;
  /** The in-app channel's id (a UUID) in this Knock environment. */
  inAppChannelId: string;
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
};

export function createKnockTransport({
  secretKey,
  inAppChannelId,
  fetch: fetchKnock = globalThis.fetch,
  baseUrl = KNOCK_API,
}: KnockTransportOptions): NotificationTransport {
  /** Makes one Knock call. Rejects unless Knock answers 2xx. */
  async function callKnock({ method, path, body, idempotencyKey }: KnockCall) {
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
  };
}
