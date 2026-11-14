import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";
import {
  browserPushPermission,
  browserPushToken,
  canUseBrowserPush,
  registerBrowserForPush,
  sendPushToken,
} from "./browser-push";
import type { BrowserPushConfig } from "./firebase-config";
import {
  pushWasTurnedOnHere,
  rememberPushTurnedOnHere,
} from "./push-turned-on-here";
import {
  pushTokenNeedsSending,
  pushUpkeepOnLoad,
  type BrowserPushRegistration,
} from "./push-upkeep";
import { useBrowserPushConfig } from "./use-browser-push";

/**
 * Does what `pushUpkeepOnLoad` decides for the person signed in. Resolves
 * true when the server's registration changed. Never prompts: it acts only
 * while permission is granted.
 */
async function keepBrowserPushCurrent({
  config,
  userId,
  registration,
}: {
  config: BrowserPushConfig;
  userId: number;
  registration: BrowserPushRegistration | null;
}) {
  // Covers people who turned on push here before the browser kept a record.
  if (registration) rememberPushTurnedOnHere(userId);

  const upkeep = pushUpkeepOnLoad({
    registration,
    permission: browserPushPermission(),
    turnedOnHere: pushWasTurnedOnHere(userId),
  });
  if (upkeep === "nothing" || !(await canUseBrowserPush())) return false;

  if (upkeep === "register-again") {
    const result = await registerBrowserForPush(config);
    return result.outcome === "registered";
  }

  if (!registration) return false;
  const token = await browserPushToken(config);
  if (!pushTokenNeedsSending({ registration, token, now: new Date() })) {
    return false;
  }
  await sendPushToken(token);
  return true;
}

/**
 * Keeps browser push working on each app load, for the person signed in:
 * refreshes this browser's token when it's registered for them, or
 * registers it again, without asking, when they turned on push here before
 * and permission is still granted. Runs once per person signed in.
 * `registration` is this browser's registration for them, from the session.
 */
export function useKeepBrowserPushCurrent({
  userId,
  registration,
}: {
  userId: number | null;
  registration: BrowserPushRegistration | null;
}) {
  const config = useBrowserPushConfig();
  const revalidator = useRevalidator();
  const revalidate = useRef(revalidator.revalidate);
  revalidate.current = revalidator.revalidate;
  const latestRegistration = useRef(registration);
  latestRegistration.current = registration;
  const keptCurrentFor = useRef<number | null>(null);

  useEffect(() => {
    if (userId === null) keptCurrentFor.current = null;
    if (!config || userId === null || keptCurrentFor.current === userId) {
      return;
    }
    keptCurrentFor.current = userId;

    keepBrowserPushCurrent({
      config,
      userId,
      registration: latestRegistration.current,
    })
      .then((changed) => {
        // Settings and the asks show whether push is on here.
        if (changed) return revalidate.current();
      })
      .catch((error: unknown) => {
        console.warn("[notifications] Couldn't keep browser push current:", error);
      });
  }, [config, userId]);
}
