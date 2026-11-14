import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIREBASE_VERSION, serviceWorkerScript } from "./service-worker.server";

const firebaseConfig = {
  apiKey: "firebase-api-key",
  projectId: "cadence-dev",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc",
};

const packageJson: { dependencies: Record<string, string> } = JSON.parse(
  readFileSync("package.json", "utf8")
);

describe("Cadence's service worker, /sw.js", () => {
  it("loads Firebase's compat scripts pinned to the firebase version in package.json", () => {
    const pinned = packageJson.dependencies.firebase;
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(FIREBASE_VERSION).toBe(pinned);

    const script = serviceWorkerScript({ firebaseConfig, firebaseVersion: "13.3.0" });

    expect(script).toContain(
      'importScripts("https://www.gstatic.com/firebasejs/13.3.0/firebase-app-compat.js");'
    );
    expect(script).toContain(
      'importScripts("https://www.gstatic.com/firebasejs/13.3.0/firebase-messaging-compat.js");'
    );
  });

  it("writes in the environment's Firebase config and starts Firebase messaging", () => {
    const script = serviceWorkerScript({ firebaseConfig, firebaseVersion: "13.3.0" });

    expect(script).toContain(
      `firebase.initializeApp(${JSON.stringify(firebaseConfig)});`
    );
    expect(script).toContain("firebase.messaging();");
  });

  it("leaves clicks to Firebase: no notificationclick handler", () => {
    const script = serviceWorkerScript({ firebaseConfig, firebaseVersion: "13.3.0" });

    expect(script).not.toContain("notificationclick");
  });

  it("loads no Firebase when Knock isn't configured", () => {
    const script = serviceWorkerScript({
      firebaseConfig: null,
      firebaseVersion: "13.3.0",
    });

    expect(script).not.toContain("importScripts");
    expect(script).not.toContain("firebase");
  });
});
