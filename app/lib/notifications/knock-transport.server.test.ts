import { describe, expect, it, vi } from "vitest";
import { createKnockTransport } from "./knock-transport.server";

const buyer = { id: "12", name: "Ada Buyer", email: "ada@example.com" };
const reviewer = { id: "3", name: "Rex Reviewer", email: "rex@example.com" };

function knockAnswering(status: number, body: unknown = {}) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
  );
}

function onlyCall(fetchMock: ReturnType<typeof knockAnswering>) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  const headers = new Headers(init?.headers);
  return {
    url: String(url),
    method: init?.method,
    headers,
    body: JSON.parse(String(init?.body)),
  };
}

describe("the real Knock adapter", () => {
  it("triggers a workflow the way Knock expects", async () => {
    const fetchMock = knockAnswering(200, { workflow_run_id: "run-1" });
    const transport = createKnockTransport({
      secretKey: "sk_test_secret",
      inAppChannelId: "in-app-channel-uuid",
      fetch: fetchMock,
    });

    await transport.trigger(
      "refund-request-decided",
      {
        recipients: [buyer],
        actor: reviewer,
        data: {
          outcome: "approved",
          courseTitle: "Intro to Testing",
          decisionNote: "Within the refund window.",
          notificationId: "notification-1",
          path: "/courses/intro-to-testing",
        },
      },
      { idempotencyKey: "notification-1" }
    );

    const call = onlyCall(fetchMock);
    expect(call.method).toBe("POST");
    expect(call.url).toBe(
      "https://api.knock.app/v1/workflows/refund-request-decided/trigger"
    );
    expect(call.headers.get("authorization")).toBe("Bearer sk_test_secret");
    expect(call.headers.get("idempotency-key")).toBe("notification-1");
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.body).toEqual({
      recipients: [buyer],
      actor: reviewer,
      data: {
        outcome: "approved",
        courseTitle: "Intro to Testing",
        decisionNote: "Within the refund window.",
        notificationId: "notification-1",
        path: "/courses/intro-to-testing",
      },
    });
  });

  it("rejects when Knock doesn't accept the trigger, so the outbox tries again", async () => {
    const transport = createKnockTransport({
      secretKey: "sk_test_secret",
      inAppChannelId: "in-app-channel-uuid",
      fetch: knockAnswering(422, { message: "Invalid recipients" }),
    });

    await expect(
      transport.trigger(
        "refund-request-decided",
        { recipients: [buyer], actor: reviewer, data: {} },
        { idempotencyKey: "notification-2" }
      )
    ).rejects.toThrow(/422.*Invalid recipients/);
  });

  it("bulk archives every in-app copy picked by a trigger-data key and value the way Knock expects", async () => {
    const fetchMock = knockAnswering(200, { id: "bulk-1", status: "queued" });
    const transport = createKnockTransport({
      secretKey: "sk_test_secret",
      inAppChannelId: "in-app-channel-uuid",
      fetch: fetchMock,
    });

    await transport.bulkArchive({
      workflowKey: "new-open-refund-request",
      key: "refundRequestId",
      value: 7,
    });

    const call = onlyCall(fetchMock);
    expect(call.method).toBe("POST");
    expect(call.url).toBe(
      "https://api.knock.app/v1/channels/in-app-channel-uuid/messages/bulk/archive"
    );
    expect(call.headers.get("authorization")).toBe("Bearer sk_test_secret");
    expect(call.headers.get("content-type")).toBe("application/json");
    // Knock takes trigger_data as a JSON string, and matches the value's type.
    expect(call.body).toEqual({
      trigger_data: '{"refundRequestId":7}',
      workflows: ["new-open-refund-request"],
    });
  });

  it("rejects when Knock doesn't accept the bulk archive, so the outbox tries again", async () => {
    const transport = createKnockTransport({
      secretKey: "sk_test_secret",
      inAppChannelId: "in-app-channel-uuid",
      fetch: knockAnswering(500, { message: "Internal error" }),
    });

    await expect(
      transport.bulkArchive({
        workflowKey: "new-open-refund-request",
        key: "refundRequestId",
        value: 7,
      })
    ).rejects.toThrow(/500.*Internal error/);
  });

  it("rejects when Knock can't be reached", async () => {
    const transport = createKnockTransport({
      secretKey: "sk_test_secret",
      inAppChannelId: "in-app-channel-uuid",
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError("fetch failed");
      }),
    });

    await expect(
      transport.trigger(
        "refund-request-decided",
        { recipients: [buyer], actor: reviewer, data: {} },
        { idempotencyKey: "notification-3" }
      )
    ).rejects.toThrow("fetch failed");
  });
});
