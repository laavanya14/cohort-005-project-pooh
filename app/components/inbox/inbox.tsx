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
// feed API. Without Knock configured, it shows the drawer's notice instead.

const PAGE_SIZE = 20;

/** One Knock feed client per Inbox tab, so each has its own counts and pages. */
const TAB_CLIENT_OPTIONS: Record<InboxTabKey, FeedClientOptions> = {
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

function useInboxTab(channelId: string, key: InboxTabKey) {
  const knock = useKnockClient();
  const tabClient = useNotifications(knock, channelId, TAB_CLIENT_OPTIONS[key]);
  const state = useNotificationStore(tabClient);

  useEffect(() => {
    void tabClient.fetch();
  }, [tabClient]);

  return { tabClient, tab: toTab(state) };
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
async function allUnread(
  tabClient: Feed,
  kind: InboxKind
): Promise<FeedItem[]> {
  const unread = tabClient.knock.feeds.initialize(tabClient.feedId, {
    ...TAB_CLIENT_OPTIONS[kind],
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

  const waitingOnYou = useInboxTab(channelId, "waiting-on-you");
  const aboutYou = useInboxTab(channelId, "about-you");
  const activity = useInboxTab(channelId, "activity");
  const archived = useInboxTab(channelId, "archived");

  const tabClients: Record<InboxTabKey, Feed> = {
    "waiting-on-you": waitingOnYou.tabClient,
    "about-you": aboutYou.tabClient,
    activity: activity.tabClient,
    archived: archived.tabClient,
  };

  /** Runs a change against the Knock item behind a notification. */
  function change(
    notification: InboxNotification,
    act: (tabClient: Feed, item: FeedItem) => Promise<unknown>
  ) {
    const tabClient = notification.archived
      ? tabClients.archived
      : tabClients[notification.kind];
    const item = tabClient
      .getState()
      .items.find((candidate) => candidate.id === notification.id);
    if (item) act(tabClient, item).catch(showError);
  }

  function openNotification(notification: InboxNotification) {
    setOpen(false);
    if (!notification.read) {
      change(notification, (tabClient, item) => tabClient.markAsRead(item));
    }
    void navigate(notification.path);
  }

  async function markAllRead(kind: InboxKind) {
    const tabClient = tabClients[kind];
    const loadedUnread = tabClient.getState().items.filter((i) => !i.read_at);
    if (loadedUnread.length > 0) await tabClient.markAsRead(loadedUnread);

    // Knock's markAllAsRead() would mark every kind read, so mark this kind's
    // unread notifications one page at a time instead.
    const loadedIds = new Set(loadedUnread.map((item) => item.id));
    const rest = (await allUnread(tabClient, kind)).filter(
      (item) => !loadedIds.has(item.id)
    );
    for (let i = 0; i < rest.length; i += 50) {
      const ids = rest.slice(i, i + 50).map((item) => item.id);
      await tabClient.knock.messages.batchUpdateStatuses(ids, "read");
    }
    if (rest.length > 0) await tabClient.fetch();
  }

  // The pop-up for new notifications that arrive while the page is open.
  useEffect(() => {
    const popUpTabClients = POP_UP_KINDS.map((kind) => tabClients[kind]);

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

    for (const tabClient of popUpTabClients)
      tabClient.on("items.received.realtime", popUp);
    return () => {
      for (const tabClient of popUpTabClients)
        tabClient.off("items.received.realtime", popUp);
    };
    // The tab clients are stable, and openNotification only uses them and setters.
  }, [waitingOnYou.tabClient, aboutYou.tabClient]);

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
        onMarkRead={(n) =>
          change(n, (tabClient, item) => tabClient.markAsRead(item))
        }
        onMarkUnread={(n) =>
          change(n, (tabClient, item) => tabClient.markAsUnread(item))
        }
        onMarkAllRead={(kind) => {
          markAllRead(kind).catch(showError);
        }}
        onArchive={(n) =>
          change(n, async (tabClient, item) => {
            await tabClient.markAsArchived(item);
            await tabClients.archived.fetch();
          })
        }
        onUnarchive={(n) =>
          change(n, async (tabClient, item) => {
            await tabClient.markAsUnarchived(item);
            await Promise.all([
              tabClients.archived.fetch(),
              tabClients[n.kind].fetch(),
            ]);
          })
        }
        onLoadMore={(key) => {
          tabClients[key].fetchNextPage().catch(showError);
        }}
        onOpenNotificationPreferences={openNotificationPreferences}
        pushAsk={pushAsks?.inboxCard}
      />
    </>
  );
}
