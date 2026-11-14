import { useCallback, useEffect, useState } from "react";
import { useRevalidator, useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "~/root";
import {
  browserPushPermission,
  browserPushStatus,
  canUseBrowserPush,
  registerBrowserForPush,
  type BrowserPushPermission,
  type RegisterForPushResult,
} from "./browser-push";
import { browserPushConfig, type BrowserPushConfig } from "./firebase-config";

/**
 * This environment's browser push config, from the root loader, or null
 * when Knock (and so push) isn't configured.
 */
export function useBrowserPushConfig(): BrowserPushConfig | null {
  const rootData = useRouteLoaderData<typeof rootLoader>("root");
  return browserPushConfig(rootData?.notifications.knock ?? null);
}

/**
 * Browser push in this browser, for anything that shows its state or asks
 * to turn it on (the Settings row now; the Inbox card and the asks after a
 * refund request or comment later). `registeredHere` is the server's answer
 * from the session. Returns null when Knock isn't configured, so callers
 * show nothing.
 */
export function useBrowserPush({ registeredHere }: { registeredHere: boolean }) {
  const config = useBrowserPushConfig();
  const revalidator = useRevalidator();
  // Unknown until checked in the browser, after hydrating.
  const [permission, setPermission] = useState<BrowserPushPermission | null>(
    null
  );
  const [turningOn, setTurningOn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const now = browserPushPermission();
    setPermission(now);
    if (now !== "unsupported") {
      void canUseBrowserPush().then((supported) => {
        if (!cancelled && !supported) setPermission("unsupported");
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const turnOn = useCallback(async (): Promise<RegisterForPushResult | null> => {
    if (!config) return null;
    setTurningOn(true);
    try {
      const result = await registerBrowserForPush(config);
      setPermission(browserPushPermission());
      if (result.outcome === "unsupported") setPermission("unsupported");
      // The server now has this browser; reload what depends on it.
      if (result.outcome === "registered") await revalidator.revalidate();
      return result;
    } finally {
      setTurningOn(false);
    }
  }, [config, revalidator]);

  if (!config) return null;

  return {
    status: browserPushStatus({ registeredHere, permission }),
    turningOn,
    turnOn,
  };
}
