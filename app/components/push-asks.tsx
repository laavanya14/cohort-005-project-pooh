import { useEffect } from "react";
import { BellRing, Share, Smartphone, SquarePlus, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { UserRole } from "~/db/schema";
import {
  isPushAskShown,
  type PushAsk,
  type PushAskMoment,
} from "~/lib/notifications/push-ask";

// Cadence's asks to turn on browser push, display only: the card at the top
// of the Inbox, the ask right after a student raises a refund request or
// posts a comment or reply, and the Add to Home Screen steps for iPhone and
// iPad. `PushAsksProvider` (app/components/push-asks-provider.tsx) decides
// which ask to show and does what the buttons say.

const ADD_TO_HOME_SCREEN_FIRST =
  "On iPhone and iPad, add Cadence to your Home Screen first.";

/** What push would tell the person, by role. */
const PITCH_BY_ROLE: Record<UserRole, string> = {
  [UserRole.Student]:
    "Get a browser notification when a refund request is decided or someone replies to you, even when Cadence isn't open.",
  [UserRole.Instructor]:
    "Get a browser notification when a student asks a question, even when Cadence isn't open.",
  [UserRole.PlatformAdmin]:
    "Get a browser notification when a refund request comes in or a refund fails, even when Cadence isn't open.",
};

export type InboxPushAskProps = {
  ask: PushAsk;
  role: UserRole;
  /** Push is being turned on: the browser's prompt may be showing. */
  turningOn: boolean;
  onTurnOn: () => void;
  /** Snoozes the asks for 30 days. */
  onNotNow: () => void;
  /** Opens the Add to Home Screen steps. */
  onShowMeHow: () => void;
};

const CARD_TITLE_ID = "inbox-push-ask-title";

/** The card at the top of the Inbox. Shows nothing unless there's an ask. */
export function InboxPushAskCard({
  ask,
  role,
  turningOn,
  onTurnOn,
  onNotNow,
  onShowMeHow,
}: InboxPushAskProps) {
  if (!isPushAskShown(ask)) return null;
  const addToHomeScreen = ask === "add-to-home-screen";

  return (
    <section
      aria-labelledby={CARD_TITLE_ID}
      className="mx-5 mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4"
    >
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-5 text-primary" aria-hidden="true" />
        <div className="flex-1">
          <h3 id={CARD_TITLE_ID} className="text-sm font-medium">
            Turn on browser notifications
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {PITCH_BY_ROLE[role]}
            {addToHomeScreen && ` ${ADD_TO_HOME_SCREEN_FIRST}`}
          </p>
          <div className="mt-3 flex gap-2">
            {addToHomeScreen ? (
              <Button type="button" size="sm" onClick={onShowMeHow}>
                Show me how
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={turningOn}
                onClick={onTurnOn}
              >
                {turningOn ? "Turning on…" : "Turn on"}
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onNotNow}>
              Not now
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

const MOMENT_COPY: Record<PushAskMoment, { done: string; question: string }> =
  {
    "refund-request": {
      done: "Refund request sent.",
      question: "Get a browser notification when it's decided?",
    },
    comment: {
      done: "Comment posted.",
      question: "Get a browser notification when someone replies?",
    },
    reply: {
      done: "Reply posted.",
      question: "Get a browser notification when someone replies?",
    },
  };

export type PostActionPushAskProps = {
  ask: PushAsk;
  /** What the student just did. */
  moment: PushAskMoment;
  turningOn: boolean;
  onNotifyMe: () => void;
  /** Snoozes the asks for 30 days. */
  onNoThanks: () => void;
  onShowMeHow: () => void;
  /** Hides this ask without snoozing. */
  onClose: () => void;
};

const POST_ACTION_QUESTION_ID = "post-action-push-ask-question";

/**
 * The ask right after a student raises a refund request or posts a comment
 * or reply, floating at the bottom of the page.
 */
export function PostActionPushAsk({
  ask,
  moment,
  turningOn,
  onNotifyMe,
  onNoThanks,
  onShowMeHow,
  onClose,
}: PostActionPushAskProps) {
  if (!isPushAskShown(ask)) return null;
  const addToHomeScreen = ask === "add-to-home-screen";
  const copy = MOMENT_COPY[moment];

  return (
    <div
      role="dialog"
      aria-labelledby={POST_ACTION_QUESTION_ID}
      className="fixed inset-x-4 bottom-20 z-[60] mx-auto max-w-[420px] rounded-lg border border-border bg-background p-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-5 text-primary" aria-hidden="true" />
        <div className="flex-1">
          <p className="text-sm font-medium">{copy.done}</p>
          <p
            id={POST_ACTION_QUESTION_ID}
            className="text-sm text-muted-foreground"
          >
            {copy.question}
            {addToHomeScreen && ` ${ADD_TO_HOME_SCREEN_FIRST}`}
          </p>
          <div className="mt-3 flex gap-2">
            {addToHomeScreen ? (
              <Button type="button" size="sm" onClick={onShowMeHow}>
                Show me how
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={turningOn}
                onClick={onNotifyMe}
              >
                {turningOn ? "Turning on…" : "Notify me"}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onNoThanks}
            >
              No thanks
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

const SHEET_TITLE_ID = "add-to-home-screen-title";

/**
 * "Show me how": the steps to add Cadence to the Home Screen, where iPhone
 * and iPad let it send browser notifications.
 */
export function AddToHomeScreenSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[70] bg-black/40"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={SHEET_TITLE_ID}
        className="fixed inset-x-0 bottom-0 z-[80] mx-auto w-full max-w-md rounded-t-2xl bg-background p-6 shadow-2xl"
      >
        <h2 id={SHEET_TITLE_ID} className="text-base font-semibold">
          Add Cadence to your Home Screen
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          iPhone and iPad only send browser notifications to sites on your Home
          Screen. It takes three taps:
        </p>
        <ol className="mt-4 space-y-3 text-sm">
          <li className="flex items-start gap-3">
            <Share
              className="size-5 shrink-0 text-blue-600"
              aria-hidden="true"
            />
            <span>
              Tap <b>Share</b> in Safari&apos;s toolbar.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <SquarePlus className="size-5 shrink-0" aria-hidden="true" />
            <span>
              Choose <b>Add to Home Screen</b>, then <b>Add</b>.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Smartphone className="size-5 shrink-0" aria-hidden="true" />
            <span>
              Open Cadence from your Home Screen and tap <b>Turn on</b> in the
              Inbox.
            </span>
          </li>
        </ol>
        <div className="mt-5 flex justify-end">
          <Button type="button" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </>
  );
}
