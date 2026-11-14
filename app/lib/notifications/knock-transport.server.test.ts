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
      fcmChannelId: "fcm-channel-uuid",
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
      fcmChannelId: "fcm-channel-uuid",
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
      fcmChannelId: "fcm-channel-uuid",
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
      fcmChannelId: "fcm-channel-uuid",
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
      fcmChannelId: "fcm-channel-uuid",
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

describe("the real Knock adapter's notification preferences", () => {
  function transportAnswering(fetchMock: ReturnType<typeof knockAnswering>) {
    return createKnockTransport({
      secretKey: "sk_test_secret",
      inAppChannelId: "in-app-channel-uuid",
      fcmChannelId: "fcm-channel-uuid",
      fetch: fetchMock,
    });
  }

  it("reads the person's workflow-level preferences, push and email per workflow", async () => {
    const fetchMock = knockAnswering(200, {
      id: "default",
      workflows: {
        "instructor-or-platform-admin-reply": {
          channel_types: { push: false, email: true, in_app_feed: true },
        },
        "new-open-refund-request": false,
        "student-top-level-comment": true,
      },
      categories: {},
      channel_types: {},
    });

    const preferences =
      await transportAnswering(fetchMock).preferences.get("12");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://api.knock.app/v1/users/12/preferences/default"
    );
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer sk_test_secret"
    );
    // A workflow turned off as a whole has every channel off.
    expect(preferences).toEqual({
      "instructor-or-platform-admin-reply": { push: false, email: true },
      "new-open-refund-request": { push: false, email: false },
      "student-top-level-comment": { push: true, email: true },
    });
  });

  it("reads a channel Knock holds conditions for as on", async () => {
    const preferences = await transportAnswering(
      knockAnswering(200, {
        id: "default",
        workflows: {
          "refund-request-decided": {
            channel_types: { push: { conditions: [] } },
          },
        },
      })
    ).preferences.get("12");

    expect(preferences).toEqual({ "refund-request-decided": {} });
  });

  it("reads no preferences for someone Knock doesn't know yet, so everything is on", async () => {
    const preferences = await transportAnswering(
      knockAnswering(404, { code: "resource_missing" })
    ).preferences.get("99");

    expect(preferences).toEqual({});
  });

  it("merges a change into the person's preferences, leaving the rest alone", async () => {
    const fetchMock = knockAnswering(200, { id: "default" });

    await transportAnswering(fetchMock).preferences.set("12", {
      "instructor-or-platform-admin-reply": { email: false },
    });

    const call = onlyCall(fetchMock);
    expect(call.method).toBe("PUT");
    expect(call.url).toBe(
      "https://api.knock.app/v1/users/12/preferences/default"
    );
    expect(call.headers.get("authorization")).toBe("Bearer sk_test_secret");
    expect(call.body).toEqual({
      workflows: {
        "instructor-or-platform-admin-reply": {
          channel_types: { email: false },
        },
      },
      __persistence_strategy__: "merge",
    });
  });

  it("rejects when Knock doesn't accept the change", async () => {
    await expect(
      transportAnswering(
        knockAnswering(500, { message: "Internal error" })
      ).preferences.set("12", { "refund-request-decided": { push: false } })
    ).rejects.toThrow(/500.*Internal error/);
  });
});

describe("the real Knock adapter's push tokens", () => {
  function transportAnswering(fetchMock: ReturnType<typeof knockAnswering>) {
    return createKnockTransport({
      secretKey: "sk_test_secret",
      inAppChannelId: "in-app-channel-uuid",
      fcmChannelId: "fcm-channel-uuid",
      fetch: fetchMock,
    });
  }

  it("replaces the person's whole token list on the FCM channel", async () => {
    const fetchMock = knockAnswering(200, { data: { tokens: [] } });

    await transportAnswering(fetchMock).setPushTokens("12", [
      "laptop-token",
      "phone-token",
    ]);

    const call = onlyCall(fetchMock);
    expect(call.method).toBe("PUT");
    expect(call.url).toBe(
      "https://api.knock.app/v1/users/12/channel_data/fcm-channel-uuid"
    );
    expect(call.headers.get("authorization")).toBe("Bearer sk_test_secret");
    expect(call.body).toEqual({
      data: { tokens: ["laptop-token", "phone-token"] },
    });
  });

  it("unsets the person's list when it's empty", async () => {
    const fetchMock = knockAnswering(200);

    await transportAnswering(fetchMock).setPushTokens("12", []);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe("DELETE");
    expect(String(url)).toBe(
      "https://api.knock.app/v1/users/12/channel_data/fcm-channel-uuid"
    );
  });

  it("treats unsetting a list Knock doesn't have as done", async () => {
    await expect(
      transportAnswering(
        knockAnswering(404, { code: "resource_missing" })
      ).setPushTokens("12", [])
    ).resolves.toBeUndefined();
  });

  it("rejects when Knock doesn't accept the list, so the outbox tries again", async () => {
    await expect(
      transportAnswering(
        knockAnswering(500, { message: "Internal error" })
      ).setPushTokens("12", ["laptop-token"])
    ).rejects.toThrow(/500.*Internal error/);
  });
});
