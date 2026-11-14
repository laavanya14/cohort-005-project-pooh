import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { UserRole } from "~/db/schema";
import {
  AddToHomeScreenSheet,
  PostActionPushAsk,
  type InboxPushAskProps,
} from "~/components/push-asks";
import {
  browserPushPermission,
  canUseBrowserPush,
} from "~/lib/notifications/browser-push";
import {
  currentDeviceHints,
  decidePushAsk,
  isIosOutsideInstalledApp,
  REFUND_REQUEST_SENT_PARAM,
  REFUND_REQUEST_SENT_VALUE,
  type PushAskBrowser,
  type PushAskMoment,
} from "~/lib/notifications/push-ask";
import {
  pushAsksSnoozedUntil,
  snoozePushAsks,
} from "~/lib/notifications/push-ask-snooze";
import { useBrowserPush } from "~/lib/notifications/use-browser-push";

// Connects the display-only push asks (push-asks.tsx) to the browser, the
// person's snooze and `useBrowserPush`. Mounted once in the app layout for
// the person signed in. It shows the ask after a student raises a refund
// request or posts a comment or reply, and the Add to Home Screen steps; the
// Inbox wrapper reads the Inbox card's props from `usePushAsks`.

type PushAsksContextValue = {
  inboxCard: InboxPushAskProps;
  /**
   * Asks about push right after a student does something they'll want to
   * hear back about. Does nothing for other roles.
   */
  askAfter: (moment: PushAskMoment) => void;
};

const PushAsksContext = createContext<PushAsksContextValue | null>(null);

/** The push asks for the person signed in, or null outside the app layout. */
export function usePushAsks() {
  return useContext(PushAsksContext);
}

/** Checks this browser once it has hydrated. */
function useBrowserCheck() {
  const [browser, setBrowser] = useState<PushAskBrowser | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const iosOutsideInstalledApp = isIosOutsideInstalledApp(
        currentDeviceHints()
      );
      const permission = browserPushPermission();
      const pushSupported =
        permission !== "unsupported" && (await canUseBrowserPush());
      if (cancelled) return;
      setBrowser({
        iosOutsideInstalledApp,
        pushSupported,
        permission: permission === "unsupported" ? "default" : permission,
      });
    }
    check().catch((error: unknown) => {
      console.warn("[notifications] Couldn't check browser push:", error);
      if (!cancelled) {
        setBrowser({
          iosOutsideInstalledApp: false,
          pushSupported: false,
          permission: "default",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return [browser, setBrowser] as const;
}

/** The streamed answer to "has the person turned push off for every event?". */
function useResolved(promise: Promise<boolean>) {
  const [resolved, setResolved] = useState<{
    promise: Promise<boolean>;
    value: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void promise.then((value) => {
      if (!cancelled) setResolved({ promise, value });
    });
    return () => {
      cancelled = true;
    };
  }, [promise]);

  return resolved?.promise === promise ? resolved.value : null;
}

export function PushAsksProvider({
  userId,
  role,
  registeredHere,
  pushOffForEveryEvent,
  children,
}: {
  userId: number;
  role: UserRole;
  /** This browser is registered for push for the person, from the session. */
  registeredHere: boolean;
  /** From the layout loader, streamed because it comes from Knock. */
  pushOffForEveryEvent: Promise<boolean>;
  children: React.ReactNode;
}) {
  const push = useBrowserPush({ registeredHere });
  const [browser, setBrowser] = useBrowserCheck();
  const pushOff = useResolved(pushOffForEveryEvent);

  // Per person: these start over when someone else signs in.
  const [snoozedUntil, setSnoozedUntil] = useState<{
    userId: number;
    until: number | null;
  } | null>(null);
  const [registeredFor, setRegisteredFor] = useState<number | null>(null);
  const [moment, setMoment] = useState<PushAskMoment | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setSnoozedUntil({ userId, until: pushAsksSnoozedUntil(userId) });
    setMoment(null);
  }, [userId]);

  const ask = decidePushAsk({
    knockConfigured: push !== null,
    registeredHere: registeredHere || registeredFor === userId,
    // Hidden until Knock has answered.
    pushOffForEveryEvent: pushOff !== false,
    // Hidden until the snooze has been read for this person.
    browser: snoozedUntil?.userId === userId ? browser : null,
    snoozedUntil: snoozedUntil?.until ?? null,
    now: Date.now(),
  });

  const snooze = useCallback(() => {
    setSnoozedUntil({ userId, until: snoozePushAsks(userId) });
    setMoment(null);
  }, [userId]);

  const turnOn = useCallback(async () => {
    if (!push) return;
    try {
      const result = await push.turnOn();
      if (!result) return;
      switch (result.outcome) {
        case "registered":
          setRegisteredFor(userId);
          setMoment(null);
          toast.success("Browser push is on in this browser.");
          return;
        case "dismissed":
          // Closing the browser's prompt counts as "Not now".
          snooze();
          return;
        case "blocked":
          setBrowser((now) => now && { ...now, permission: "denied" });
          setMoment(null);
          return;
        case "unsupported":
          setBrowser((now) => now && { ...now, pushSupported: false });
          setMoment(null);
          return;
      }
    } catch (error) {
      console.error("[notifications] Couldn't turn on browser push:", error);
      toast.error("Couldn't turn on browser push. Try again.");
    }
  }, [push, userId, snooze, setBrowser]);

  const askAfter = useCallback(
    (next: PushAskMoment) => {
      if (role === UserRole.Student) setMoment(next);
    },
    [role]
  );

  // The refund request action redirects here with ?refund-request=sent.
  const [searchParams, setSearchParams] = useSearchParams();
  const refundRequestSent =
    searchParams.get(REFUND_REQUEST_SENT_PARAM) === REFUND_REQUEST_SENT_VALUE;
  useEffect(() => {
    if (!refundRequestSent) return;
    askAfter("refund-request");
    setSearchParams(
      (params) => {
        params.delete(REFUND_REQUEST_SENT_PARAM);
        return params;
      },
      { replace: true, preventScrollReset: true }
    );
  }, [refundRequestSent, askAfter, setSearchParams]);

  const showMeHow = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const value: PushAsksContextValue = {
    inboxCard: {
      ask,
      role,
      turningOn: push?.turningOn ?? false,
      onTurnOn: () => void turnOn(),
      onNotNow: snooze,
      onShowMeHow: showMeHow,
    },
    askAfter,
  };

  return (
    <PushAsksContext.Provider value={value}>
      {children}
      {moment && (
        <PostActionPushAsk
          ask={ask}
          moment={moment}
          turningOn={push?.turningOn ?? false}
          onNotifyMe={() => void turnOn()}
          onNoThanks={snooze}
          onShowMeHow={() => {
            setMoment(null);
            showMeHow();
          }}
          onClose={() => setMoment(null)}
        />
      )}
      <AddToHomeScreenSheet open={sheetOpen} onClose={closeSheet} />
    </PushAsksContext.Provider>
  );
}
