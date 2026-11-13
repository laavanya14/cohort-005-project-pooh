import { afterEach, describe, expect, it, vi } from "vitest";
import { createNotificationTransport } from "./create-transport.server";

const person = { id: "1", name: "Ada", email: "ada@example.com" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("choosing the Knock-facing interface at startup", () => {
  it("sends to Knock when KNOCK_SECRET_KEY and the rest are set", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    const transport = createNotificationTransport({
      KNOCK_SECRET_KEY: "sk_test_secret",
      KNOCK_PUBLIC_KEY: "pk_test_public",
      KNOCK_IN_APP_CHANNEL_ID: "in-app-channel-uuid",
    });
    await transport.trigger(
      "refund-request-decided",
      { recipients: [person], actor: person, data: {} },
      { idempotencyKey: "notification-1" }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.knock.app/v1/workflows/refund-request-decided/trigger",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws when KNOCK_SECRET_KEY is set without the rest", () => {
    expect(() =>
      createNotificationTransport({ KNOCK_SECRET_KEY: "sk_test_secret" })
    ).toThrow(/KNOCK_PUBLIC_KEY/);
  });
});
