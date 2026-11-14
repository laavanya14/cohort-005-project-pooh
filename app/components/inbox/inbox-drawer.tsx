import { useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  BellRing,
  CheckCheck,
  Inbox as InboxIcon,
  MessageSquare,
  Settings,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import {
  INBOX_KINDS,
  inboxKindLabels,
  type InboxKind,
  type InboxNotification,
} from "~/lib/notifications/inbox-items";
import {
  InboxPushAskCard,
  type InboxPushAskProps,
} from "~/components/push-asks";

// The Inbox drawer, display only: it shows what it's given and reports what
// the person did through callbacks. It never talks to Knock. The wrapper in
// `inbox.tsx` connects it to Knock's headless hooks. To add to it, add a prop
// here and pass it from there.

/** The Notifications section of Settings, where the header's gear goes. */
export const NOTIFICATION_PREFERENCES_PATH = "/settings#notifications";

export type InboxTabKey = InboxKind | "archived";

export type InboxTab = {
  /** The pages loaded so far. */
  notifications: InboxNotification[];
  /** Unread notifications in the tab, loaded or not. */
  unreadCount: number;
  /** Every notification in the tab, loaded or not. */
  totalCount: number;
  /** Another page can be loaded. */
  hasMore: boolean;
  loading: boolean;
};

export type InboxDrawerProps = {
  open: boolean;
  /** Without Knock, the drawer shows a notice for developers instead. */
  knockConfigured: boolean;
  tabs: Record<InboxTabKey, InboxTab>;
  /** For the relative times. Defaults to the current time. */
  now?: Date;
  onClose: () => void;
  /** The person opened the notification to go to its page. */
  onOpen: (notification: InboxNotification) => void;
  onMarkRead: (notification: InboxNotification) => void;
  onMarkUnread: (notification: InboxNotification) => void;
  /** Marks every unread notification of this kind read, loaded or not. */
  onMarkAllRead: (kind: InboxKind) => void;
  onArchive: (notification: InboxNotification) => void;
  onUnarchive: (notification: InboxNotification) => void;
  onLoadMore: (tab: InboxTabKey) => void;
  /** The person followed the header's gear to the Notifications section. */
  onOpenNotificationPreferences: () => void;
  /** The ask to turn on browser push, shown above the tabs when there is one. */
  pushAsk?: InboxPushAskProps;
};

function hasNotifications(tab: InboxTab) {
  return tab.totalCount > 0 || tab.notifications.length > 0;
}

function tabLabel(key: InboxTabKey) {
  return key === "archived" ? "Archived" : inboxKindLabels[key];
}

/** "Waiting on you, 3 unread", for screen readers; the badge is visual. */
function withUnread(label: string, unreadCount: number) {
  return unreadCount > 0 ? `${label}, ${unreadCount} unread` : label;
}

function UnreadBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

const kindIcons: Record<InboxKind, React.ReactNode> = {
  "waiting-on-you": <Sparkles className="size-4" />,
  "about-you": <UserRound className="size-4" />,
  activity: <MessageSquare className="size-4" />,
};

const kindTones: Record<InboxKind, string> = {
  "waiting-on-you":
    "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  "about-you":
    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  activity: "bg-muted text-muted-foreground",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Just now", "5m ago", "3h ago", "2d ago", then the date. */
function formatInboxTime(insertedAt: string, now: Date) {
  const at = new Date(insertedAt);
  const ago = now.getTime() - at.getTime();

  if (ago < MINUTE) return "Just now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h ago`;
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)}d ago`;
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

type ItemActions = Pick<
  InboxDrawerProps,
  "onOpen" | "onMarkRead" | "onMarkUnread" | "onArchive" | "onUnarchive"
>;

/** A click the browser should handle itself, such as opening a new tab. */
function isModifiedClick(event: React.MouseEvent) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

function InboxItem({
  notification,
  now,
  actions,
}: {
  notification: InboxNotification;
  now: Date;
  actions: ItemActions;
}) {
  const { kind, headline, detail, context, insertedAt, read, sentByPush } =
    notification;
  const headlineId = `inbox-item-${notification.id}`;

  return (
    <article
      aria-labelledby={headlineId}
      className={cn(
        "rounded-lg border p-4 transition-colors",
        read ? "border-border" : "border-primary/40 bg-primary/5"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          role="img"
          aria-label={inboxKindLabels[kind]}
          className={cn("rounded-md p-1.5", kindTones[kind])}
        >
          {kindIcons[kind]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3
              id={headlineId}
              className={cn("text-sm", !read && "font-semibold")}
            >
              {headline}
            </h3>
            <time
              dateTime={insertedAt}
              title={new Date(insertedAt).toLocaleString()}
              className="shrink-0 text-xs text-muted-foreground"
            >
              {formatInboxTime(insertedAt, now)}
            </time>
          </div>
          {context && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {context}
            </div>
          )}
        </div>
      </div>
      {detail && (
        <blockquote className="mt-3 border-l-2 border-border pl-3 text-sm text-muted-foreground">
          {detail}
        </blockquote>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={notification.path}
          onClick={(event) => {
            if (isModifiedClick(event)) {
              if (!read) actions.onMarkRead(notification);
              return;
            }
            event.preventDefault();
            actions.onOpen(notification);
          }}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {kind === "waiting-on-you" ? "Review" : "Open"}
        </a>
        <button
          type="button"
          onClick={() =>
            read
              ? actions.onMarkUnread(notification)
              : actions.onMarkRead(notification)
          }
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          {read ? "Mark unread" : "Mark read"}
        </button>
        <button
          type="button"
          onClick={() =>
            notification.archived
              ? actions.onUnarchive(notification)
              : actions.onArchive(notification)
          }
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          {notification.archived ? (
            <>
              <ArchiveRestore className="size-3.5" aria-hidden="true" />
              Unarchive
            </>
          ) : (
            <>
              <Archive className="size-3.5" aria-hidden="true" />
              Archive
            </>
          )}
        </button>
        {sentByPush && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
            <BellRing className="size-3" aria-hidden="true" />
            Also sent by push
          </span>
        )}
      </div>
    </article>
  );
}

/** The Inbox item at the top of the sidebar. */
export function InboxSidebarItem({
  unreadCount,
  onClick,
  active = false,
}: {
  unreadCount: number;
  onClick: () => void;
  /** The drawer is open. */
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={withUnread("Inbox", unreadCount)}
      aria-haspopup="dialog"
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <InboxIcon className="size-4" aria-hidden="true" />
      Inbox
      <UnreadBadge
        count={unreadCount}
        className="ml-auto h-5 min-w-5 text-[11px]"
      />
    </button>
  );
}

function KnockNotice() {
  return (
    <p className="m-5 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
      Knock isn't configured, so Notifications are written to{" "}
      <code className="rounded bg-muted px-1 py-0.5 text-xs">
        .outbox/notifications/
      </code>
    </p>
  );
}

export function InboxDrawer(props: InboxDrawerProps) {
  const { open, knockConfigured, onClose, now = new Date() } = props;

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
        className="fixed inset-0 z-40 bg-black/30"
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbox-drawer-title"
        className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-[480px] flex-col border-l border-border bg-background shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="inbox-drawer-title" className="text-lg font-semibold">
            Inbox
          </h2>
          <div className="flex items-center gap-1">
            <a
              href={NOTIFICATION_PREFERENCES_PATH}
              onClick={(event) => {
                if (isModifiedClick(event)) return;
                event.preventDefault();
                props.onOpenNotificationPreferences();
              }}
              aria-label="Notification preferences"
              title="Notification preferences"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            >
              <Settings className="size-5" />
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the inbox"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {knockConfigured ? (
          <>
            {props.pushAsk && <InboxPushAskCard {...props.pushAsk} />}
            <InboxTabs {...props} now={now} />
          </>
        ) : (
          <KnockNotice />
        )}
      </aside>
    </>
  );
}

function InboxTabs(props: InboxDrawerProps & { now: Date }) {
  const { tabs, now } = props;
  const [selectedTab, setSelectedTab] = useState<InboxTabKey | null>(null);

  const visibleTabs: InboxTabKey[] = [
    ...INBOX_KINDS.filter((kind) => hasNotifications(tabs[kind])),
    "archived",
  ];
  const activeTab =
    selectedTab && visibleTabs.includes(selectedTab)
      ? selectedTab
      : visibleTabs[0];
  const shown = tabs[activeTab];

  return (
    <>
      <div role="tablist" className="flex gap-1 border-b border-border px-3">
        {visibleTabs.map((key) => {
          const unreadCount = key === "archived" ? 0 : tabs[key].unreadCount;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-label={withUnread(tabLabel(key), unreadCount)}
              aria-selected={key === activeTab}
              onClick={() => setSelectedTab(key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm",
                key === activeTab
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <span data-label>{tabLabel(key)}</span>
              <UnreadBadge count={unreadCount} />
            </button>
          );
        })}
      </div>

      {activeTab !== "archived" && shown.unreadCount > 0 && (
        <div className="flex justify-end px-5 pt-3">
          <button
            type="button"
            onClick={() => props.onMarkAllRead(activeTab)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <CheckCheck className="size-3.5" aria-hidden="true" />
            Mark all as read
          </button>
        </div>
      )}

      <div role="tabpanel" className="flex-1 space-y-3 overflow-y-auto p-5">
        {shown.notifications.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {shown.loading
              ? "Loading…"
              : activeTab === "archived"
                ? "Nothing archived."
                : "Nothing here. You're all caught up."}
          </div>
        ) : (
          shown.notifications.map((notification) => (
            <InboxItem
              key={notification.id}
              notification={notification}
              now={now}
              actions={props}
            />
          ))
        )}
        {shown.hasMore && (
          <button
            type="button"
            disabled={shown.loading}
            onClick={() => props.onLoadMore(activeTab)}
            className="w-full rounded-md border border-border py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            {shown.loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </>
  );
}
