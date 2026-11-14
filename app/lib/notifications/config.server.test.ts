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
    KNOCK_FCM_CHANNEL_ID: "fcm-channel-uuid",
    FIREBASE_API_KEY: "firebase-api-key",
    FIREBASE_PROJECT_ID: "cadence-dev",
    FIREBASE_MESSAGING_SENDER_ID: "1234567890",
    FIREBASE_APP_ID: "1:1234567890:web:abc",
    FIREBASE_VAPID_KEY: "vapid-public-key",
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
        fcmChannelId: "fcm-channel-uuid",
        firebaseApiKey: "firebase-api-key",
        firebaseProjectId: "cadence-dev",
        firebaseMessagingSenderId: "1234567890",
        firebaseAppId: "1:1234567890:web:abc",
        firebaseVapidKey: "vapid-public-key",
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

  it("throws when Knock is set up but the Firebase config for browser push isn't", () => {
    expect(() =>
      readNotificationConfig(
        knockEnv({ FIREBASE_VAPID_KEY: undefined, KNOCK_FCM_CHANNEL_ID: "" })
      )
    ).toThrow(/KNOCK_FCM_CHANNEL_ID, FIREBASE_VAPID_KEY/);
  });

  it("ignores the rest when the secret key isn't set", () => {
    expect(
      readNotificationConfig({ KNOCK_PUBLIC_KEY: "pk_test_public" })
    ).toEqual({ knock: null });
  });
});

describe("what the browser gets", () => {
  it("gets Knock's public key, in-app channel id and the Firebase web config, never the secret key", () => {
    const browser = publicNotificationConfig(readNotificationConfig(knockEnv()));

    expect(browser).toEqual({
      knock: {
        publicKey: "pk_test_public",
        inAppChannelId: "in-app-channel-uuid",
        firebaseApiKey: "firebase-api-key",
        firebaseProjectId: "cadence-dev",
        firebaseMessagingSenderId: "1234567890",
        firebaseAppId: "1:1234567890:web:abc",
        firebaseVapidKey: "vapid-public-key",
      },
    });
    expect(JSON.stringify(browser)).not.toContain("sk_test_secret");
  });

  it("gets nothing for Knock when Cadence uses the fake", () => {
    expect(publicNotificationConfig(readNotificationConfig({}))).toEqual({
      knock: null,
    });
  });
});
