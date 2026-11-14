// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBrowserForPush } from "./browser-push";
import type { BrowserPushConfig } from "./firebase-config";

// Firebase is replaced, so nothing reaches the network.
vi.mock("firebase/app", () => ({
  getApps: () => [],
  getApp: () => ({}),
  initializeApp: () => ({}),
}));
vi.mock("firebase/messaging", () => ({
  isSupported: async () => true,
  getMessaging: () => ({}),
  getToken: async () => "fcm-token-1",
}));

const CONFIG: BrowserPushConfig = {
  firebase: {
    apiKey: "api-key",
    projectId: "cadence-test",
    messagingSenderId: "123",
    appId: "app-id",
  },
  vapidKey: "vapid-key",
};

const requestPermission = vi.fn<() => Promise<NotificationPermission>>();
const fetchMock = vi.fn<typeof fetch>();

function givenPermission(permission: NotificationPermission) {
  vi.stubGlobal("Notification", { permission, requestPermission });
}

beforeEach(() => {
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: async () => ({}) },
  });
  fetchMock.mockResolvedValue(
    Response.json({ registrationId: 42, userId: 7 })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  requestPermission.mockReset();
  fetchMock.mockReset();
});

describe("registerBrowserForPush", () => {
  it("registers straight away, with no browser prompt, when permission is already granted", async () => {
    givenPermission("granted");

    const result = await registerBrowserForPush(CONFIG);

    expect(result).toEqual({ outcome: "registered", registrationId: 42 });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("reports a closed browser prompt as dismissed", async () => {
    givenPermission("default");
    requestPermission.mockResolvedValue("default");

    expect(await registerBrowserForPush(CONFIG)).toEqual({
      outcome: "dismissed",
    });
  });

  it("reports a blocked browser prompt as blocked", async () => {
    givenPermission("default");
    requestPermission.mockResolvedValue("denied");

    expect(await registerBrowserForPush(CONFIG)).toEqual({
      outcome: "blocked",
    });
  });
});
