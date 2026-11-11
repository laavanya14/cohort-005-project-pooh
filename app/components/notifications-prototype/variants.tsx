// PROTOTYPE — throwaway. Three structurally different bell/inbox designs for
// "What do the bell and inbox look like in Cadence?", switchable with
// ?variant=A|B|C on any page inside the app layout. State is in memory only;
// nothing calls Knock or writes to the DB.
//
//   A  Bell popover      — bell in the sidebar header, one flat feed (what
//                          Knock's ready-made <NotificationFeedPopover> gives us)
//   B  Inbox drawer      — "Inbox" nav item, full-height drawer, tab per kind,
//                          archive (custom UI on Knock's headless hooks)
//   C  To-do + bell      — "Waiting on you" lives in the sidebar as a to-do
//                          list cleared by "Done"; bell by the avatar holds the
//                          rest, with Knock's seen-vs-read split
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  Inbox,
  MessageSquare,
  Receipt,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import {
  kindLabel,
  type MockNotification,
  type NotificationKind,
} from "./fixtures";

// ---------------------------------------------------------------- store

interface Item extends MockNotification {
  seen: boolean;
  archived: boolean;
  done: boolean;
}

export function useNotificationStore(initial: MockNotification[], key: string) {
  const fresh = () =>
    initial.map((n) => ({ ...n, seen: n.read, archived: false, done: false }));
  const [items, setItems] = useState<Item[]>(fresh);
  useEffect(() => setItems(fresh()), [key]); // reset when the DevUI user changes

  const patch = (pred: (i: Item) => boolean, p: Partial<Item>) =>
    setItems((xs) => xs.map((i) => (pred(i) ? { ...i, ...p } : i)));

  return {
    items,
    markRead: (id: string, read = true) =>
      patch((i) => i.id === id, { read, seen: true }),
    markAllRead: (kinds?: NotificationKind[]) =>
      patch((i) => !kinds || kinds.includes(i.kind), { read: true, seen: true }),
    markAllSeen: (kinds?: NotificationKind[]) =>
      patch((i) => !kinds || kinds.includes(i.kind), { seen: true }),
    archive: (id: string, archived = true) =>
      patch((i) => i.id === id, { archived, read: true, seen: true }),
    done: (id: string) =>
      patch((i) => i.id === id, { done: true, read: true, seen: true }),
    reset: () => setItems(fresh()),
  };
}

export type NotificationStore = ReturnType<typeof useNotificationStore>;

export interface Slots {
  header?: React.ReactNode;
  nav?: React.ReactNode;
  section?: React.ReactNode;
  footer?: React.ReactNode;
  overlay?: React.ReactNode;
}

export const VARIANTS = [
  { key: "A", name: "Bell popover" },
  { key: "B", name: "Inbox drawer, tabs by kind" },
  { key: "C", name: "To-do list + activity bell" },
];

export function describeState(store: NotificationStore) {
  const live = store.items.filter((i) => !i.archived && !i.done);
  return `${live.filter((i) => !i.read).length} unread · ${
    live.filter((i) => !i.seen).length
  } unseen · ${store.items.filter((i) => i.archived).length} archived · ${
    store.items.filter((i) => i.done).length
  } done`;
}

// ---------------------------------------------------------------- shared bits

const kindIcon: Record<NotificationKind, React.ReactNode> = {
  waiting: <Sparkles className="size-3.5" />,
  about: <UserRound className="size-3.5" />,
  fyi: <MessageSquare className="size-3.5" />,
};

function Who({ n, size = "size-8" }: { n: Item; size?: string }) {
  if (n.actor)
    return (
      <UserAvatar
        name={n.actor.name}
        avatarUrl={n.actor.avatarUrl}
        className={cn(size, "shrink-0")}
      />
    );
  return (
    <div
      className={cn(
        size,
        "flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      )}
    >
      <Receipt className="size-4" />
    </div>
  );
}

function PayoutTag({ n }: { n: Item }) {
  if (!n.needsPayoutTracking) return null;
  return (
    <span
      title="Needs payout tracking, which is out of scope for this map"
      className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
    >
      needs payout tracking
    </span>
  );
}

function Badge({ count, className }: { count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white",
        className
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

function useOpen(store: NotificationStore, item: Item, after?: () => void) {
  const navigate = useNavigate();
  return () => {
    store.markRead(item.id);
    after?.();
    navigate(item.href);
  };
}

// ================================================================ Variant A

function RowA({
  n,
  store,
  close,
}: {
  n: Item;
  store: NotificationStore;
  close: () => void;
}) {
  const open = useOpen(store, n, close);
  return (
    <button
      onClick={open}
      className={cn(
        "flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent",
        !n.read && "bg-primary/5"
      )}
    >
      <Who n={n} />
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm", !n.read && "font-semibold")}>
          {n.title}
        </div>
        {n.detail && (
          <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
            {n.detail}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{n.context}</span>
          <span>· {n.at}</span>
          <PayoutTag n={n} />
        </div>
      </div>
      {!n.read && (
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500" />
      )}
    </button>
  );
}

export function useVariantA(store: NotificationStore): Slots {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const live = store.items.filter((i) => !i.archived);
  const unseen = live.filter((i) => !i.seen).length;
  const shown = filter === "all" ? live : live.filter((i) => !i.read);

  return {
    header: (
      <button
        onClick={() => {
          setOpen((o) => !o);
          store.markAllSeen();
        }}
        title="Notifications"
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-5" />
        <Badge count={unseen} className="absolute -right-0.5 -top-0.5" />
      </button>
    ),
    overlay: open && (
      <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div className="fixed left-[232px] top-2 z-50 flex max-h-[75vh] w-[400px] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="font-semibold">Notifications</span>
              <div className="flex rounded-md bg-muted p-0.5 text-xs">
                {(["all", "unread"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "rounded px-2 py-0.5 capitalize",
                      filter === f && "bg-background shadow-sm"
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => store.markAllRead()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="size-3.5" /> Mark all as read
            </button>
          </div>
          <div className="overflow-y-auto">
            {shown.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                You're all caught up.
              </div>
            ) : (
              shown.map((n) => (
                <RowA
                  key={n.id}
                  n={n}
                  store={store}
                  close={() => setOpen(false)}
                />
              ))
            )}
          </div>
        </div>
      </>
    ),
  };
}

// ================================================================ Variant B

const kindTone: Record<NotificationKind, string> = {
  waiting: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  about: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  fyi: "bg-muted text-muted-foreground",
};

function CardB({
  n,
  store,
  close,
}: {
  n: Item;
  store: NotificationStore;
  close: () => void;
}) {
  const open = useOpen(store, n, close);
  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        n.read ? "border-border" : "border-primary/40 bg-primary/5"
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("rounded-md p-1.5", kindTone[n.kind])}>
          {kindIcon[n.kind]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className={cn("text-sm", !n.read && "font-semibold")}>
              {n.title}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {n.at}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {n.context}
          </div>
        </div>
      </div>
      {n.detail && (
        <blockquote className="mt-3 border-l-2 border-border pl-3 text-sm text-muted-foreground">
          {n.detail}
        </blockquote>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={open}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {n.kind === "waiting" ? "Review" : "Open"}
        </button>
        <button
          onClick={() => store.markRead(n.id, !n.read)}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          Mark {n.read ? "unread" : "read"}
        </button>
        <button
          onClick={() => store.archive(n.id, !n.archived)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          {n.archived ? (
            <>
              <ArchiveRestore className="size-3.5" /> Unarchive
            </>
          ) : (
            <>
              <Archive className="size-3.5" /> Archive
            </>
          )}
        </button>
        <span className="ml-auto flex items-center gap-2">
          <PayoutTag n={n} />
          {n.push && (
            <span
              title="Also sent as a browser push notification"
              className="flex items-center gap-1 text-[10px] text-muted-foreground"
            >
              <BellRing className="size-3" /> push
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

export function useVariantB(store: NotificationStore): Slots {
  const [open, setOpen] = useState(false);
  const kinds = (["waiting", "about", "fyi"] as const).filter((k) =>
    store.items.some((i) => i.kind === k)
  );
  const [tab, setTab] = useState<NotificationKind | "archived">("waiting");
  const activeTab = tab === "archived" || kinds.includes(tab as never) ? tab : kinds[0];
  const unread = store.items.filter((i) => !i.read && !i.archived).length;
  const shown =
    activeTab === "archived"
      ? store.items.filter((i) => i.archived)
      : store.items.filter((i) => i.kind === activeTab && !i.archived);

  return {
    nav: (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          open
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Inbox className="size-4" />
        Inbox
        <Badge count={unread} className="ml-auto h-5 min-w-5 text-[11px]" />
      </button>
    ),
    overlay: open && (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={() => setOpen(false)}
        />
        <aside className="fixed right-0 top-0 z-50 flex h-screen w-[480px] flex-col border-l border-border bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-lg font-semibold">Inbox</h2>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="flex gap-1 border-b border-border px-3">
            {[...kinds, "archived" as const].map((k) => {
              const count =
                k === "archived"
                  ? 0
                  : store.items.filter(
                      (i) => i.kind === k && !i.read && !i.archived
                    ).length;
              return (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={cn(
                    "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm",
                    activeTab === k
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {k === "archived" ? "Archived" : kindLabel[k]}
                  <Badge count={count} />
                </button>
              );
            })}
          </div>
          {activeTab !== "archived" && (
            <div className="flex justify-end px-5 pt-3">
              <button
                onClick={() => store.markAllRead([activeTab])}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <CheckCheck className="size-3.5" /> Mark all as read
              </button>
            </div>
          )}
          <div className="flex-1 space-y-3 overflow-y-auto p-5 pt-3">
            {shown.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                {activeTab === "archived"
                  ? "Nothing archived."
                  : "Nothing here. You're all caught up."}
              </div>
            ) : (
              shown.map((n) => (
                <CardB
                  key={n.id}
                  n={n}
                  store={store}
                  close={() => setOpen(false)}
                />
              ))
            )}
          </div>
        </aside>
      </>
    ),
  };
}

// ================================================================ Variant C

function TodoC({ n, store }: { n: Item; store: NotificationStore }) {
  const open = useOpen(store, n);
  return (
    <div className="group flex items-start gap-2 rounded-md px-3 py-2 hover:bg-sidebar-accent">
      <button
        onClick={() => store.done(n.id)}
        title="Done (clears it from the list)"
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-sidebar-foreground/40 text-transparent hover:border-primary hover:text-primary"
      >
        <Check className="size-3" />
      </button>
      <button onClick={open} className="min-w-0 flex-1 text-left">
        <div
          className={cn(
            "truncate text-sm",
            n.read ? "text-sidebar-foreground/70" : "font-semibold"
          )}
        >
          {n.title}
        </div>
        <div className="flex items-center gap-1.5 truncate text-xs text-sidebar-foreground/50">
          <span className="truncate">{n.context}</span>
          <span className="shrink-0">· {n.at}</span>
        </div>
        <PayoutTag n={n} />
      </button>
    </div>
  );
}

function RowC({
  n,
  store,
  close,
}: {
  n: Item;
  store: NotificationStore;
  close: () => void;
}) {
  const open = useOpen(store, n, close);
  return (
    <button
      onClick={open}
      className="flex w-full gap-3 rounded-md px-3 py-2 text-left hover:bg-accent"
    >
      <div className="relative">
        <Who n={n} size="size-7" />
        {!n.read && (
          <span className="absolute -left-1 top-0 size-2 rounded-full bg-blue-500 ring-2 ring-popover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span className={cn(!n.read && "font-semibold")}>{n.title}</span>{" "}
          <span className="text-xs text-muted-foreground">{n.at}</span>
        </div>
        {n.detail && (
          <div className="line-clamp-1 text-xs text-muted-foreground">
            {n.detail}
          </div>
        )}
        <div className="truncate text-xs text-muted-foreground/80">
          {n.context}
        </div>
        <PayoutTag n={n} />
      </div>
    </button>
  );
}

export function useVariantC(store: NotificationStore): Slots {
  const [open, setOpen] = useState(false);
  const todos = store.items.filter((i) => i.kind === "waiting" && !i.done);
  const hasWaitingKind = store.items.some((i) => i.kind === "waiting");
  const feed = store.items.filter((i) => i.kind !== "waiting");
  const unseen = feed.filter((i) => !i.seen).length;
  const days = ["Today", "Yesterday", "Earlier"] as const;

  return {
    section: hasWaitingKind && (
      <div className="border-t border-sidebar-border p-3">
        <div className="mb-2 flex items-center justify-between px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Waiting on you
          <span className="rounded-full bg-orange-500 px-1.5 text-[10px] text-white">
            {todos.length || ""}
          </span>
        </div>
        {todos.length === 0 ? (
          <div className="px-3 py-2 text-xs text-sidebar-foreground/50">
            Nothing waiting on you.
          </div>
        ) : (
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {todos.map((n) => (
              <TodoC key={n.id} n={n} store={store} />
            ))}
          </div>
        )}
      </div>
    ),
    footer: (
      <button
        onClick={() => {
          setOpen((o) => !o);
          store.markAllSeen(["about", "fyi"]);
        }}
        title="Activity"
        className="relative rounded-md p-1 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        {unseen > 0 && (
          <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-red-500 ring-2 ring-sidebar" />
        )}
      </button>
    ),
    overlay: open && (
      <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div className="fixed bottom-3 left-[232px] z-50 flex max-h-[70vh] w-[380px] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Activity</span>
            <button
              onClick={() => store.markAllRead(["about", "fyi"])}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="size-3.5" /> Mark all as read
            </button>
          </div>
          <div className="overflow-y-auto p-1.5">
            {feed.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                No activity yet.
              </div>
            )}
            {days.map((d) => {
              const group = feed.filter((i) => i.day === d);
              if (group.length === 0) return null;
              return (
                <div key={d}>
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {d}
                  </div>
                  {group.map((n) => (
                    <RowC
                      key={n.id}
                      n={n}
                      store={store}
                      close={() => setOpen(false)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </>
    ),
  };
}
