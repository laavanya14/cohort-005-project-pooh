import { describe, expect, it } from "vitest";
import {
  publicNotificationConfig,
  readNotificationConfig,
} from "./config.server";

function knockEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    KNOCK_SECRET_KEY: "sk_test_secret",
    KNOCK_PUBLIC_KEY: "pk_test_public",
    KNOCK_IN_APP_CHANNEL_ID: "in-app-channel-uuid",
    ...overrides,
  };
}

describe("the Knock switch", () => {
  it("uses the fake when KNOCK_SECRET_KEY isn't set", () => {
    expect(readNotificationConfig({})).toEqual({ knock: null });
  });

  it("treats an empty KNOCK_SECRET_KEY as not set", () => {
    expect(readNotificationConfig({ KNOCK_SECRET_KEY: "" })).toEqual({
      knock: null,
    });
  });

  it("uses Knock when the secret key and every value it needs are set", () => {
    expect(readNotificationConfig(knockEnv())).toEqual({
      knock: {
        secretKey: "sk_test_secret",
        publicKey: "pk_test_public",
        inAppChannelId: "in-app-channel-uuid",
      },
    });
  });

  it("throws, naming every missing value, when the secret key is set without the rest", () => {
    expect(() =>
      readNotificationConfig(
        knockEnv({ KNOCK_PUBLIC_KEY: undefined, KNOCK_IN_APP_CHANNEL_ID: "" })
      )
    ).toThrow(/KNOCK_PUBLIC_KEY, KNOCK_IN_APP_CHANNEL_ID/);
  });

  it("ignores the rest when the secret key isn't set", () => {
    expect(
      readNotificationConfig({ KNOCK_PUBLIC_KEY: "pk_test_public" })
    ).toEqual({ knock: null });
  });
});

describe("what the browser gets", () => {
  it("gets Knock's public key and in-app channel id, never the secret key", () => {
    const browser = publicNotificationConfig(readNotificationConfig(knockEnv()));

    expect(browser).toEqual({
      knock: { publicKey: "pk_test_public", inAppChannelId: "in-app-channel-uuid" },
    });
    expect(JSON.stringify(browser)).not.toContain("sk_test_secret");
  });

  it("gets nothing for Knock when Cadence uses the fake", () => {
    expect(publicNotificationConfig(readNotificationConfig({}))).toEqual({
      knock: null,
    });
  });
});
