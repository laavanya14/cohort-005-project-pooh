// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  InboxDrawer,
  InboxSidebarItem,
  type InboxDrawerProps,
  type InboxTab,
  type InboxTabKey,
} from "./inbox-drawer";
import type { InboxNotification } from "~/lib/notifications/inbox-items";

const NOW = new Date("2026-11-13T12:00:00Z");

function notification(
  overrides: Partial<InboxNotification> = {}
): InboxNotification {
  return {
    id: "n-1",
    kind: "about-you",
    headline: "Refund request approved",
    detail: "Intro to TypeScript · “Sorry it wasn't a fit”",
    context: "Intro to TypeScript",
    insertedAt: "2026-11-13T11:55:00Z",
    read: false,
    archived: false,
    sentByPush: false,
    path: "/courses/intro-to-typescript",
    ...overrides,
  };
}

function tab(notifications: InboxNotification[] = []): InboxTab {
  return {
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
    totalCount: notifications.length,
    hasMore: false,
    loading: false,
  };
}

function emptyTabs(): Record<InboxTabKey, InboxTab> {
  return {
    "waiting-on-you": tab(),
    "about-you": tab(),
    activity: tab(),
    archived: tab(),
  };
}

function renderDrawer(overrides: Partial<InboxDrawerProps> = {}) {
  const props: InboxDrawerProps = {
    open: true,
    knockConfigured: true,
    tabs: emptyTabs(),
    now: NOW,
    onClose: () => {},
    onOpen: () => {},
    onMarkRead: () => {},
    onMarkUnread: () => {},
    onMarkAllRead: () => {},
    onArchive: () => {},
    onUnarchive: () => {},
    onLoadMore: () => {},
    onOpenNotificationPreferences: () => {},
    ...overrides,
  };
  return render(<InboxDrawer {...props} />);
}

function tabLabels() {
  return screen
    .getAllByRole("tab")
    .map((t) => t.querySelector("[data-label]")?.textContent);
}

describe("InboxDrawer", () => {
  it("shows a tab only for kinds that have notifications, and always Archived", () => {
    renderDrawer({
      tabs: {
        ...emptyTabs(),
        "about-you": tab([notification()]),
        activity: tab([notification({ id: "n-2", kind: "activity" })]),
      },
    });

    expect(tabLabels()).toEqual(["About you", "Activity", "Archived"]);
  });

  it("shows only Archived when there are no notifications", () => {
    renderDrawer();

    expect(tabLabels()).toEqual(["Archived"]);
  });

  it("shows each tab's own unread count, counting notifications not loaded yet", () => {
    renderDrawer({
      tabs: {
        ...emptyTabs(),
        "waiting-on-you": {
          ...tab([notification({ kind: "waiting-on-you" })]),
          unreadCount: 7,
          totalCount: 30,
        },
        "about-you": tab([
          notification({ id: "a-1" }),
          notification({ id: "a-2", read: true }),
        ]),
        activity: tab([
          notification({ id: "f-1", kind: "activity", read: true }),
        ]),
      },
    });

    expect(
      screen.getByRole("tab", { name: /^Waiting on you/ })
    ).toHaveAccessibleName("Waiting on you, 7 unread");
    expect(
      screen.getByRole("tab", { name: /^About you/ })
    ).toHaveAccessibleName("About you, 1 unread");
    expect(screen.getByRole("tab", { name: /^Activity/ })).toHaveAccessibleName(
      "Activity"
    );
  });

  it("shows each notification's kind, headline, time, context, quoted detail and push marker", () => {
    renderDrawer({
      tabs: {
        ...emptyTabs(),
        "about-you": tab([
          notification({
            headline: "Refund request declined",
            detail: "“Outside the refund window”",
            context: "Intro to TypeScript",
            insertedAt: "2026-11-13T11:55:00Z",
            sentByPush: true,
          }),
        ]),
      },
    });

    const item = screen.getByRole("article", {
      name: "Refund request declined",
    });
    expect(within(item).getByRole("img", { name: "About you" })).toBeVisible();
    expect(within(item).getByText("5m ago")).toBeVisible();
    expect(within(item).getByText("Intro to TypeScript")).toBeVisible();
    expect(
      within(item)
        .getByText("“Outside the refund window”")
        .closest("blockquote")
    ).not.toBeNull();
    expect(within(item).getByText("Also sent by push")).toBeVisible();
  });

  it("shows no push marker or empty quote when there is none", () => {
    renderDrawer({
      tabs: {
        ...emptyTabs(),
        activity: tab([
          notification({
            kind: "activity",
            headline: "3 new enrollments",
            detail: "",
            sentByPush: false,
          }),
        ]),
      },
    });

    const item = screen.getByRole("article", { name: "3 new enrollments" });
    expect(within(item).queryByText("Also sent by push")).toBeNull();
    expect(item.querySelector("blockquote")).toBeNull();
  });

  it("lists only the selected tab's notifications", async () => {
    const user = userEvent.setup();
    renderDrawer({
      tabs: {
        ...emptyTabs(),
        "waiting-on-you": tab([
          notification({
            id: "w-1",
            kind: "waiting-on-you",
            headline: "New refund request",
          }),
        ]),
        archived: tab([
          notification({
            id: "x-1",
            archived: true,
            headline: "Ada replied to your comment",
          }),
        ]),
      },
    });

    expect(
      screen.getByRole("article", { name: "New refund request" })
    ).toBeVisible();
    expect(
      screen.queryByRole("article", { name: "Ada replied to your comment" })
    ).toBeNull();

    await user.click(screen.getByRole("tab", { name: /^Archived/ }));

    expect(
      screen.getByRole("article", { name: "Ada replied to your comment" })
    ).toBeVisible();
    expect(
      screen.queryByRole("article", { name: "New refund request" })
    ).toBeNull();
  });

  it("offers Review for Waiting on you and Open for other kinds, linking to the notification's page", async () => {
    const user = userEvent.setup();
    const opened: InboxNotification[] = [];
    const refundRequest = notification({
      id: "w-1",
      kind: "waiting-on-you",
      headline: "New refund request",
      path: "/admin/refund-requests",
    });
    const reply = notification({
      id: "a-1",
      kind: "about-you",
      headline: "Ada replied to your comment",
      path: "/courses/ts/lessons/generics#comment-12",
    });
    renderDrawer({
      tabs: {
        ...emptyTabs(),
        "waiting-on-you": tab([refundRequest]),
        "about-you": tab([reply]),
      },
      onOpen: (n) => opened.push(n),
    });

    const review = within(
      screen.getByRole("article", { name: "New refund request" })
    ).getByRole("link", { name: "Review" });
    expect(review).toHaveAttribute("href", "/admin/refund-requests");
    await user.click(review);
    expect(opened).toEqual([refundRequest]);

    await user.click(screen.getByRole("tab", { name: /^About you/ }));
    const open = within(
      screen.getByRole("article", { name: "Ada replied to your comment" })
    ).getByRole("link", { name: "Open" });
    expect(open).toHaveAttribute(
      "href",
      "/courses/ts/lessons/generics#comment-12"
    );
    await user.click(open);
    expect(opened).toEqual([refundRequest, reply]);
  });

  it("marks a notification read or unread, and archives it, by hand", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const unread = notification({ id: "a-1", headline: "Unread one" });
    const read = notification({ id: "a-2", headline: "Read one", read: true });
    renderDrawer({
      tabs: { ...emptyTabs(), "about-you": tab([unread, read]) },
      onMarkRead: (n) => calls.push(`read ${n.id}`),
      onMarkUnread: (n) => calls.push(`unread ${n.id}`),
      onArchive: (n) => calls.push(`archive ${n.id}`),
      onUnarchive: (n) => calls.push(`unarchive ${n.id}`),
    });

    const unreadItem = screen.getByRole("article", { name: "Unread one" });
    const readItem = screen.getByRole("article", { name: "Read one" });
    await user.click(
      within(unreadItem).getByRole("button", { name: "Mark read" })
    );
    await user.click(
      within(readItem).getByRole("button", { name: "Mark unread" })
    );
    await user.click(within(readItem).getByRole("button", { name: "Archive" }));
    expect(
      within(readItem).queryByRole("button", { name: "Unarchive" })
    ).toBeNull();

    expect(calls).toEqual(["read a-1", "unread a-2", "archive a-2"]);
  });

  it("unarchives a notification from Archived", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    renderDrawer({
      tabs: {
        ...emptyTabs(),
        archived: tab([
          notification({ id: "x-1", headline: "Archived one", archived: true }),
        ]),
      },
      onArchive: (n) => calls.push(`archive ${n.id}`),
      onUnarchive: (n) => calls.push(`unarchive ${n.id}`),
    });

    const item = screen.getByRole("article", { name: "Archived one" });
    expect(within(item).queryByRole("button", { name: "Archive" })).toBeNull();
    await user.click(within(item).getByRole("button", { name: "Unarchive" }));

    expect(calls).toEqual(["unarchive x-1"]);
  });

  it("marks all as read in the selected tab only", async () => {
    const user = userEvent.setup();
    const markedAllRead: string[] = [];
    renderDrawer({
      tabs: {
        ...emptyTabs(),
        "waiting-on-you": tab([
          notification({ id: "w-1", kind: "waiting-on-you" }),
        ]),
        activity: tab([notification({ id: "f-1", kind: "activity" })]),
      },
      onMarkAllRead: (kind) => markedAllRead.push(kind),
    });

    await user.click(screen.getByRole("button", { name: "Mark all as read" }));
    await user.click(screen.getByRole("tab", { name: /^Activity/ }));
    await user.click(screen.getByRole("button", { name: "Mark all as read" }));

    expect(markedAllRead).toEqual(["waiting-on-you", "activity"]);
  });

  it("offers Mark all as read only when the tab has unread notifications", async () => {
    const user = userEvent.setup();
    renderDrawer({
      tabs: {
        ...emptyTabs(),
        "about-you": tab([notification({ read: true })]),
        archived: tab([notification({ id: "x-1", archived: true })]),
      },
    });

    expect(
      screen.queryByRole("button", { name: "Mark all as read" })
    ).toBeNull();
    await user.click(screen.getByRole("tab", { name: /^Archived/ }));
    expect(
      screen.queryByRole("button", { name: "Mark all as read" })
    ).toBeNull();
  });

  it("tells developers where notifications go when Knock isn't configured", () => {
    renderDrawer({ knockConfigured: false });

    expect(screen.getByRole("dialog", { name: "Inbox" })).toHaveTextContent(
      "Knock isn't configured, so Notifications are written to .outbox/notifications/"
    );
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("loads the next page of the selected tab only when asked", async () => {
    const user = userEvent.setup();
    const loaded: InboxTabKey[] = [];
    renderDrawer({
      tabs: {
        ...emptyTabs(),
        "about-you": {
          ...tab([notification()]),
          totalCount: 40,
          hasMore: true,
        },
        archived: tab([notification({ id: "x-1", archived: true })]),
      },
      onLoadMore: (key) => loaded.push(key),
    });

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(loaded).toEqual(["about-you"]);

    await user.click(screen.getByRole("tab", { name: /^Archived/ }));
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("says so when there is nothing in a tab", () => {
    renderDrawer();

    expect(screen.getByText("Nothing archived.")).toBeVisible();
  });

  it("closes from its close button and with Escape", async () => {
    const user = userEvent.setup();
    let closed = 0;
    renderDrawer({ onClose: () => closed++ });

    await user.click(screen.getByRole("button", { name: "Close the inbox" }));
    await user.keyboard("{Escape}");

    expect(closed).toBe(2);
  });

  it.each([true, false])(
    "links from its header to the Notifications section of Settings (Knock configured: %s)",
    async (knockConfigured) => {
      const user = userEvent.setup();
      let opened = 0;
      renderDrawer({
        knockConfigured,
        onOpenNotificationPreferences: () => opened++,
      });

      const gear = screen.getByRole("link", {
        name: "Notification preferences",
      });
      expect(gear).toHaveAttribute("href", "/settings#notifications");
      await user.click(gear);

      expect(opened).toBe(1);
    }
  );
});

describe("InboxSidebarItem", () => {
  it("shows the unread count and opens the inbox", async () => {
    const user = userEvent.setup();
    let opened = 0;
    render(<InboxSidebarItem unreadCount={4} onClick={() => opened++} />);

    const item = screen.getByRole("button", { name: "Inbox, 4 unread" });
    expect(item).toHaveTextContent("4");
    await user.click(item);
    expect(opened).toBe(1);
  });

  it("shows no count when everything is read", () => {
    render(<InboxSidebarItem unreadCount={0} onClick={() => {}} />);

    expect(screen.getByRole("button", { name: "Inbox" })).toHaveTextContent(
      /^Inbox$/
    );
  });
});
