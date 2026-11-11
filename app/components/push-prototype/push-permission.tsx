// PROTOTYPE — throwaway. "When and how does Cadence ask for browser push
// permission?" Variants of the ask, switchable with ?variant=A|B|C|D on any app
// page. The Inbox is drawer B from the inbox prototype. Everything is
// simulated in memory: no real Notification.requestPermission(), no Firebase,
// no Knock. The fuchsia panel bottom-left fakes the device and the browser.
//
//   A  Inbox card       — a card at the top of the Inbox drawer asks
//   B  Moment of need   — asked right after a Student does something they'll
//                          want to hear back about (Refund Request, question)
//   C  Settings only    — no proactive ask; the Inbox links to Settings
//   D  A + B together   — the recommendation
//
// Every variant has the "This browser" row in Settings, the permanent control.
import { useEffect, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { BellRing, Share, SquarePlus, X, Smartphone } from "lucide-react";
import { cn } from "~/lib/utils";

export const PUSH_VARIANTS = [
  { key: "A", name: "Inbox card" },
  { key: "B", name: "Moment of need" },
  { key: "C", name: "Settings only" },
  { key: "D", name: "Inbox card + moment of need" },
];

type Device = "desktop" | "iphone-safari" | "iphone-app";
type Permission = "default" | "granted" | "denied";
type Moment = "refund" | "question";

interface State {
  userId: string;
  role: string | null;
  variant: string;
  device: Device;
  // The browser's own permission, per device ("app" = Home Screen app,
  // which on iOS has its own permission separate from Safari).
  permission: Record<Device, Permission>;
  // Cadence has a push registration for (this person, this browser).
  registered: boolean;
  // People who turned on push in this browser (localStorage in the real thing),
  // so they're registered again on sign-in without asking.
  remembered: Record<Device, string[]>;
  snoozedUntil: Record<string, number>; // per person
  prompt: null | { source: string };
  installSheet: boolean;
  moment: null | Moment;
  log: string[];
}

const DAY = 24 * 60 * 60 * 1000;

const initial = (): State => ({
  userId: "none",
  role: null,
  variant: "D",
  device: "desktop",
  permission: { desktop: "default", "iphone-safari": "default", "iphone-app": "default" },
  registered: false,
  remembered: { desktop: [], "iphone-safari": [], "iphone-app": [] },
  snoozedUntil: {},
  prompt: null,
  installSheet: false,
  moment: null,
  log: [],
});

let state = initial();
const listeners = new Set<() => void>();
function set(patch: Partial<State> | ((s: State) => Partial<State>), log?: string) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p, log: log ? [log, ...state.log].slice(0, 6) : state.log };
  listeners.forEach((l) => l());
}
export function usePush() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => state
  );
}

// ---------------------------------------------------------------- rules

function snoozed(s: State) {
  return (s.snoozedUntil[s.userId] ?? 0) > Date.now();
}
/** Should a proactive (in-app) ask be shown at all? */
function canAsk(s: State) {
  return !!s.role && !s.registered && s.permission[s.device] !== "denied" && !snoozed(s);
}
const has = (s: State, flag: "inbox" | "moment") =>
  flag === "inbox" ? ["A", "D"].includes(s.variant) : ["B", "D"].includes(s.variant);

export const push = {
  /** A tap on any "Turn on" button. */
  turnOn(source: string) {
    const s = state;
    if (s.device === "iphone-safari") return set({ installSheet: true, moment: null }, `${source}: iPhone Safari → Add to Home Screen first`);
    if (s.permission[s.device] === "granted")
      return register(`${source}: permission already granted → registered, no browser prompt`);
    set({ prompt: { source }, moment: null }, `${source}: tap → browser prompt`);
  },
  allow() {
    set((s) => ({ permission: { ...s.permission, [s.device]: "granted" }, prompt: null }));
    register("Allowed → getToken() → registered with Cadence");
  },
  block() {
    set((s) => ({ permission: { ...s.permission, [s.device]: "denied" }, prompt: null }), "Blocked → Cadence never asks again in this browser");
  },
  dismiss() {
    set((s) => ({ prompt: null, snoozedUntil: { ...s.snoozedUntil, [s.userId]: Date.now() + 30 * DAY } }), "Prompt closed without choosing → treated as Not now (30 days)");
  },
  notNow(source: string) {
    set((s) => ({ moment: null, installSheet: false, snoozedUntil: { ...s.snoozedUntil, [s.userId]: Date.now() + 30 * DAY } }), `${source}: Not now → no asks for 30 days`);
  },
  moment(m: Moment) {
    if (!has(state, "moment")) return set({}, `Moment "${m}" — this variant doesn't ask here`);
    if (!canAsk(state)) return set({}, `Moment "${m}" — no ask (already on, blocked or snoozed)`);
    set({ moment: m });
  },
  closeInstall: () => set({ installSheet: false }),
  installed() {
    set({ device: "iphone-app", installSheet: false, registered: false }, "Added to Home Screen → opened as an app (own permission, starts 'default')");
  },
  setDevice(device: Device) {
    set((s) => ({ device, registered: s.permission[device] === "granted" && s.remembered[device].includes(s.userId), prompt: null, installSheet: false, moment: null }), `Device → ${device}`);
  },
  setPermission(p: Permission) {
    set((s) => ({ permission: { ...s.permission, [s.device]: p }, registered: p === "granted" ? s.registered : false }), `Browser settings changed by hand → ${p}`);
  },
  unsnooze: () => set((s) => ({ snoozedUntil: { ...s.snoozedUntil, [s.userId]: 0 } }), "Snooze cleared (pretend 30 days passed)"),
  reset: () => {
    const { userId, role, variant } = state;
    state = { ...initial(), userId, role, variant };
    listeners.forEach((l) => l());
  },
};

function register(log: string) {
  set((s) => ({
    registered: true,
    moment: null,
    remembered: { ...s.remembered, [s.device]: [...new Set([...s.remembered[s.device], s.userId])] },
  }), log);
}

/** Keep the store in step with the DevUI user and the ?variant= param. */
export function usePushSync(userId: string, role: string | null, variant: string) {
  useEffect(() => {
    if (state.variant !== variant) set({ variant, moment: null });
  }, [variant]);
  useEffect(() => {
    if (state.userId === userId) return;
    const s = state;
    // Sign-out removes this browser's registration; on sign-in, register again
    // silently only for someone who turned on push in this browser before.
    const again = s.permission[s.device] === "granted" && s.remembered[s.device].includes(userId);
    set({ userId, role, registered: again, prompt: null, moment: null, installSheet: false },
      `Switched user → ${again ? "registered again silently (remembered here)" : "not registered in this browser"}`);
  }, [userId, role]);
}

export function describePush(s: State) {
  const snooze = snoozed(s) ? " · snoozed 30d" : "";
  return `${s.device} · permission ${s.permission[s.device]} · ${s.registered ? "registered" : "not registered"}${snooze}`;
}

// ---------------------------------------------------------------- copy

function pitch(role: string | null) {
  if (role === "admin") return "Get a browser notification when a Refund Request comes in or a Refund fails, even when Cadence isn't open.";
  if (role === "instructor") return "Get a browser notification when a Student asks a question, even when Cadence isn't open.";
  return "Get a browser notification when a Refund Request is decided or someone replies to you, even when Cadence isn't open.";
}

// ---------------------------------------------------------------- A: Inbox card

/** Rendered at the top of the Inbox drawer. */
export function PushInboxTop() {
  const s = usePush();
  if (s.variant === "C") {
    if (s.registered || !s.role) return null;
    return (
      <div className="mx-5 mt-3 text-xs text-muted-foreground">
        Browser push is off in this browser.{" "}
        <Link to="/settings#notifications" className="underline hover:text-foreground">
          Turn it on in Settings
        </Link>
      </div>
    );
  }
  if (!has(s, "inbox") || !canAsk(s)) return null;
  const iphone = s.device === "iphone-safari";
  return (
    <div className="mx-5 mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-5 text-primary" />
        <div className="flex-1">
          <div className="text-sm font-medium">Turn on browser notifications</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {pitch(s.role)}
            {iphone && " On iPhone, add Cadence to your Home Screen first."}
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => push.turnOn("Inbox card")} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
              {iphone ? "Show me how" : "Turn on"}
            </button>
            <button onClick={() => push.notNow("Inbox card")} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- B: moment of need

function MomentCard() {
  const s = usePush();
  if (!s.moment) return null;
  const copy =
    s.moment === "refund"
      ? { done: "Refund Request sent.", ask: "Get a browser notification when it's decided?" }
      : { done: "Question posted.", ask: "Get a browser notification when someone replies?" };
  return (
    <div className="fixed bottom-20 left-1/2 z-[60] w-[420px] -translate-x-1/2 rounded-lg border border-border bg-background p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-5 text-primary" />
        <div className="flex-1">
          <div className="text-sm font-medium">{copy.done}</div>
          <p className="text-sm text-muted-foreground">
            {copy.ask}
            {s.device === "iphone-safari" && " On iPhone, add Cadence to your Home Screen first."}
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => push.turnOn("Moment card")} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
              {s.device === "iphone-safari" ? "Show me how" : "Notify me"}
            </button>
            <button onClick={() => push.notNow("Moment card")} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
              No thanks
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Settings

/** "This browser" row for the Notifications section on Settings. Every variant. */
export function PushSettingsRow() {
  const s = usePush();
  const p = s.permission[s.device];
  let body: React.ReactNode;
  if (s.registered) {
    body = (
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">On in this browser.</span> To stop it here, block
        notifications for Cadence in this browser's settings. To stop it everywhere, turn off Push for
        each event below.
      </p>
    );
  } else if (p === "denied") {
    body = (
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Blocked in this browser.</span> To turn it on, allow
        notifications for this site in your browser's site settings, then reload Cadence.
      </p>
    );
  } else if (s.device === "iphone-safari") {
    body = (
      <>
        <p className="text-sm text-muted-foreground">On iPhone and iPad, browser push works once Cadence is on your Home Screen.</p>
        <button onClick={() => push.turnOn("Settings")} className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
          Show me how
        </button>
      </>
    );
  } else {
    body = (
      <>
        <p className="text-sm text-muted-foreground">Off in this browser. Your Push settings below only reach browsers where it's on.</p>
        <button onClick={() => push.turnOn("Settings")} className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
          Turn on browser push
        </button>
      </>
    );
  }
  return (
    <div id="notifications" className="mt-8 max-w-md rounded-xl border border-border p-6">
      <h2 className="text-lg font-semibold">Notifications</h2>
      <div className="mt-4 text-sm font-medium">Browser push in this browser</div>
      <div className="mt-1">{body}</div>
      <p className="mt-6 text-xs italic text-muted-foreground">
        (Per-event Push and Email switches from "How detailed are notification preferences?" go here.)
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- fake browser UI

function BrowserPrompt() {
  const s = usePush();
  if (!s.prompt) return null;
  if (s.device === "iphone-app")
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40">
        <div className="w-72 overflow-hidden rounded-2xl bg-zinc-100 text-center text-black shadow-2xl">
          <div className="px-4 pb-3 pt-5">
            <div className="text-[15px] font-semibold">“Cadence” Would Like to Send You Notifications</div>
            <div className="mt-1 text-[13px]">Notifications may include alerts, sounds and icon badges.</div>
          </div>
          <div className="grid grid-cols-2 border-t border-zinc-300 text-[16px] text-blue-600">
            <button onClick={push.block} className="border-r border-zinc-300 py-2.5">Don't Allow</button>
            <button onClick={push.allow} className="py-2.5 font-semibold">Allow</button>
          </div>
        </div>
      </div>
    );
  return (
    <div className="fixed left-64 top-2 z-[90] w-80 rounded-lg border border-zinc-300 bg-white p-4 text-black shadow-2xl">
      <div className="flex items-start justify-between">
        <div className="text-sm">localhost:5173 wants to</div>
        <button onClick={push.dismiss} title="Close without choosing"><X className="size-4" /></button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm"><BellRing className="size-4" /> Show notifications</div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={push.block} className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-blue-700">Block</button>
        <button onClick={push.allow} className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-blue-700">Allow</button>
      </div>
      <div className="mt-2 text-[10px] text-zinc-500">(simulated browser prompt)</div>
    </div>
  );
}

function InstallSheet() {
  const s = usePush();
  if (!s.installSheet) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40" onClick={push.closeInstall}>
      <div className="w-full max-w-md rounded-t-2xl bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Get notifications on your iPhone</h3>
          <button onClick={push.closeInstall}><X className="size-5" /></button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">iPhone only sends browser notifications to sites on your Home Screen. It takes three taps:</p>
        <ol className="mt-4 space-y-3 text-sm">
          <li className="flex gap-3"><Share className="size-5 text-blue-600" /> Tap <b>Share</b> in Safari's toolbar.</li>
          <li className="flex gap-3"><SquarePlus className="size-5" /> Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          <li className="flex gap-3"><Smartphone className="size-5" /> Open Cadence from your Home Screen and tap <b>Turn on</b> in your Inbox.</li>
        </ol>
        <div className="mt-5 flex justify-between">
          <button onClick={() => push.notNow("Install sheet")} className="text-sm text-muted-foreground">Not now</button>
          <button onClick={push.installed} className="rounded-md bg-fuchsia-600 px-3 py-1.5 text-sm text-white">Simulate: I've added it and opened it</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- simulator panel

function SimPanel() {
  const s = usePush();
  if (!import.meta.env.DEV || !s.role) return null;
  const btn = "rounded px-1.5 py-0.5 hover:bg-white/20";
  const on = "bg-white/25";
  return (
    <div className="fixed bottom-4 left-60 z-[100] w-80 rounded-lg bg-fuchsia-600 p-3 text-xs text-white shadow-xl ring-2 ring-white">
      <div className="mb-1 font-semibold">Push simulator</div>
      <div className="flex flex-wrap items-center gap-1">
        Device:
        {(["desktop", "iphone-safari", "iphone-app"] as const).map((d) => (
          <button key={d} onClick={() => push.setDevice(d)} className={cn(btn, s.device === d && on)}>{d}</button>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        Browser permission:
        {(["default", "granted", "denied"] as const).map((p) => (
          <button key={p} onClick={() => push.setPermission(p)} className={cn(btn, s.permission[s.device] === p && on)}>{p}</button>
        ))}
      </div>
      {s.role === "student" && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          Do:
          <button onClick={() => push.moment("refund")} className={btn}>raise a Refund Request</button>
          <button onClick={() => push.moment("question")} className={btn}>post a question</button>
        </div>
      )}
      <div className="mt-1 flex gap-1">
        <button onClick={push.unsnooze} className={btn}>30 days pass</button>
        <button onClick={push.reset} className={btn}>reset push</button>
      </div>
      <ul className="mt-2 space-y-0.5 border-t border-white/30 pt-2 text-[11px] text-white/90">
        {s.log.map((l, i) => <li key={i} className={i === 0 ? "font-medium text-white" : ""}>• {l}</li>)}
      </ul>
    </div>
  );
}

/** Everything that floats over the page. Mount once in the app layout. */
export function PushOverlays() {
  return (
    <>
      <MomentCard />
      <BrowserPrompt />
      <InstallSheet />
      <SimPanel />
    </>
  );
}
