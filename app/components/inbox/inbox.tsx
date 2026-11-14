import { useEffect, useState } from "react";
import { useNavigate, useRouteLoaderData } from "react-router";
import { toast } from "sonner";
import {
  KnockProvider,
  useKnockClient,
  useNotifications,
  useNotificationStore,
} from "@knocklabs/react-core";
import type {
  Feed,
  FeedClientOptions,
  FeedEventPayload,
  FeedItem,
  FeedStoreState,
} from "@knocklabs/client";
import type { loader as rootLoader } from "~/root";
import { usePushAsks } from "~/components/push-asks-provider";
import {
  INBOX_KINDS,
  toInboxNotification,
  WORKFLOWS_SENT_BY_PUSH,
  type InboxKind,
  type InboxNotification,
} from "~/lib/notifications/inbox-items";
import {
  InboxDrawer,
  InboxSidebarItem,
  NOTIFICATION_PREFERENCES_PATH,
  type InboxTab,
  type InboxTabKey,
} from "./inbox-drawer";

// The thin wrapper that connects the display-only Inbox drawer to Knock's
// headless React hooks. It's the only place the browser talks to Knock's
// feed. Without Knock configured, it shows the drawer's notice instead.

const PAGE_SIZE = 20;

/** One feed client per tab, so each has its own counts and pages. */
const FEED_OPTIONS: Record<InboxTabKey, FeedClientOptions> = {
  "waiting-on-you": {
    workflow_categories: ["waiting-on-you"],
    archived: "exclude",
    page_size: PAGE_SIZE,
  },
  "about-you": {
    workflow_categories: ["about-you"],
    archived: "exclude",
    page_size: PAGE_SIZE,
  },
  activity: {
    workflow_categories: ["activity"],
    archived: "exclude",
    page_size: PAGE_SIZE,
  },
  archived: { archived: "only", page_size: PAGE_SIZE },
};

/** New notifications of these kinds pop up in the page. Activity doesn't. */
const POP_UP_KINDS: readonly InboxKind[] = ["waiting-on-you", "about-you"];

/** Shows the person's Inbox: the sidebar item and the drawer it opens. */
export function Inbox({ userId }: { userId: number }) {
  const rootData = useRouteLoaderData<typeof rootLoader>("root");
  const knock = rootData?.notifications.knock ?? null;

  if (!knock) return <InboxWithoutKnock />;

  return (
    <KnockProvider
      key={userId}
      apiKey={knock.publicKey}
      user={{ id: String(userId) }}
      identificationStrategy="skip"
    >
      <KnockInbox channelId={knock.inAppChannelId} />
    </KnockProvider>
  );
}

function emptyTab(): InboxTab {
  return {
    notifications: [],
    unreadCount: 0,
    totalCount: 0,
    hasMore: false,
    loading: false,
  };
}

function doNothing() {}

/** Closes the drawer and goes to the Notifications section of Settings. */
function useOpenNotificationPreferences(close: () => void) {
  const navigate = useNavigate();
  return () => {
    close();
    void navigate(NOTIFICATION_PREFERENCES_PATH);
  };
}

function InboxWithoutKnock() {
  const [open, setOpen] = useState(false);
  const openNotificationPreferences = useOpenNotificationPreferences(() =>
    setOpen(false)
  );

  return (
    <>
      <InboxSidebarItem
        unreadCount={0}
        active={open}
        onClick={() => setOpen(true)}
      />
      <InboxDrawer
        open={open}
        knockConfigured={false}
        tabs={{
          "waiting-on-you": emptyTab(),
          "about-you": emptyTab(),
          activity: emptyTab(),
          archived: emptyTab(),
        }}
        onClose={() => setOpen(false)}
        onOpen={doNothing}
        onMarkRead={doNothing}
        onMarkUnread={doNothing}
        onMarkAllRead={doNothing}
        onArchive={doNothing}
        onUnarchive={doNothing}
        onLoadMore={doNothing}
        onOpenNotificationPreferences={openNotificationPreferences}
      />
    </>
  );
}

function useTabFeed(channelId: string, key: InboxTabKey) {
  const knock = useKnockClient();
  const feed = useNotifications(knock, channelId, FEED_OPTIONS[key]);
  const state = useNotificationStore(feed);

  useEffect(() => {
    void feed.fetch();
  }, [feed]);

  return { feed, tab: toTab(state) };
}

function toTab(state: FeedStoreState): InboxTab {
  return {
    notifications: state.items.map((item) =>
      toInboxNotification(item, WORKFLOWS_SENT_BY_PUSH)
    ),
    unreadCount: state.metadata.unread_count,
    totalCount: state.metadata.total_count,
    hasMore: Boolean(state.pageInfo.after),
    loading: state.loading,
  };
}

/** Every unread notification of one kind, including pages not loaded. */
async function allUnread(feed: Feed, kind: InboxKind): Promise<FeedItem[]> {
  const unread = feed.knock.feeds.initialize(feed.feedId, {
    ...FEED_OPTIONS[kind],
    status: "unread",
    page_size: 50,
  });

  try {
    await unread.fetch();
    let after = unread.getState().pageInfo.after;
    while (after) {
      await unread.fetch({ after });
      after = unread.getState().pageInfo.after;
    }
    return unread.getState().items;
  } finally {
    unread.dispose();
  }
}

function showError() {
  toast.error("Couldn't update your Inbox. Try again.");
}

function KnockInbox({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const pushAsks = usePushAsks();
  const [open, setOpen] = useState(false);
  const openNotificationPreferences = useOpenNotificationPreferences(() =>
    setOpen(false)
  );

  const waitingOnYou = useTabFeed(channelId, "waiting-on-you");
  const aboutYou = useTabFeed(channelId, "about-you");
  const activity = useTabFeed(channelId, "activity");
  const archived = useTabFeed(channelId, "archived");

  const feeds: Record<InboxTabKey, Feed> = {
    "waiting-on-you": waitingOnYou.feed,
    "about-you": aboutYou.feed,
    activity: activity.feed,
    archived: archived.feed,
  };

  /** Runs a change against the feed item behind a notification. */
  function change(
    notification: InboxNotification,
    act: (feed: Feed, item: FeedItem) => Promise<unknown>
  ) {
    const feed = notification.archived
      ? feeds.archived
      : feeds[notification.kind];
    const item = feed
      .getState()
      .items.find((candidate) => candidate.id === notification.id);
    if (item) act(feed, item).catch(showError);
  }

  function openNotification(notification: InboxNotification) {
    setOpen(false);
    if (!notification.read) {
      change(notification, (feed, item) => feed.markAsRead(item));
    }
    void navigate(notification.path);
  }

  async function markAllRead(kind: InboxKind) {
    const feed = feeds[kind];
    const loadedUnread = feed.getState().items.filter((i) => !i.read_at);
    if (loadedUnread.length > 0) await feed.markAsRead(loadedUnread);

    // Knock's markAllAsRead() would mark every kind read, so mark this kind's
    // unread notifications one page at a time instead.
    const loadedIds = new Set(loadedUnread.map((item) => item.id));
    const rest = (await allUnread(feed, kind)).filter(
      (item) => !loadedIds.has(item.id)
    );
    for (let i = 0; i < rest.length; i += 50) {
      const ids = rest.slice(i, i + 50).map((item) => item.id);
      await feed.knock.messages.batchUpdateStatuses(ids, "read");
    }
    if (rest.length > 0) await feed.fetch();
  }

  // The pop-up for new notifications that arrive while the page is open.
  useEffect(() => {
    const popUpFeeds = POP_UP_KINDS.map((kind) => feeds[kind]);

    function popUp({ items }: FeedEventPayload) {
      for (const item of items) {
        const notification = toInboxNotification(item, WORKFLOWS_SENT_BY_PUSH);
        if (notification.archived || notification.read) continue;

        toast(notification.headline, {
          id: notification.id,
          description: notification.detail || undefined,
          action: {
            label: notification.kind === "waiting-on-you" ? "Review" : "Open",
            onClick: () => openNotification(notification),
          },
        });
      }
    }

    for (const feed of popUpFeeds) feed.on("items.received.realtime", popUp);
    return () => {
      for (const feed of popUpFeeds) feed.off("items.received.realtime", popUp);
    };
    // The feeds are stable, and openNotification only uses them and setters.
  }, [waitingOnYou.feed, aboutYou.feed]);

  const tabs: Record<InboxTabKey, InboxTab> = {
    "waiting-on-you": waitingOnYou.tab,
    "about-you": aboutYou.tab,
    activity: activity.tab,
    archived: archived.tab,
  };
  const unreadCount = INBOX_KINDS.reduce(
    (sum, kind) => sum + tabs[kind].unreadCount,
    0
  );

  return (
    <>
      <InboxSidebarItem
        unreadCount={unreadCount}
        active={open}
        onClick={() => setOpen(true)}
      />
      <InboxDrawer
        open={open}
        knockConfigured
        tabs={tabs}
        onClose={() => setOpen(false)}
        onOpen={openNotification}
        onMarkRead={(n) => change(n, (feed, item) => feed.markAsRead(item))}
        onMarkUnread={(n) => change(n, (feed, item) => feed.markAsUnread(item))}
        onMarkAllRead={(kind) => {
          markAllRead(kind).catch(showError);
        }}
        onArchive={(n) =>
          change(n, async (feed, item) => {
            await feed.markAsArchived(item);
            await feeds.archived.fetch();
          })
        }
        onUnarchive={(n) =>
          change(n, async (feed, item) => {
            await feed.markAsUnarchived(item);
            await Promise.all([feeds.archived.fetch(), feeds[n.kind].fetch()]);
          })
        }
        onLoadMore={(key) => {
          feeds[key].fetchNextPage().catch(showError);
        }}
        onOpenNotificationPreferences={openNotificationPreferences}
        pushAsk={pushAsks?.inboxCard}
      />
    </>
  );
}
