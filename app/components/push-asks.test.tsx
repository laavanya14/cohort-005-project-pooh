// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AddToHomeScreenSheet,
  PostActionPushAsk,
  type PostActionPushAskProps,
} from "./push-asks";

function renderAsk(overrides: Partial<PostActionPushAskProps> = {}) {
  const props: PostActionPushAskProps = {
    ask: "normal",
    moment: "refund-request",
    turningOn: false,
    onNotifyMe: () => {},
    onNoThanks: () => {},
    onShowMeHow: () => {},
    onClose: () => {},
    ...overrides,
  };
  return render(<PostActionPushAsk {...props} />);
}

function shownAsk() {
  return screen.queryByRole("dialog", { name: /browser notification/ });
}

describe("PostActionPushAsk", () => {
  it("asks right after a refund request is sent", () => {
    renderAsk({ moment: "refund-request" });

    expect(shownAsk()).toHaveTextContent("Refund request sent.");
    expect(shownAsk()).toHaveAccessibleName(
      "Get a browser notification when it's decided?"
    );
  });

  it("asks right after a comment is posted", () => {
    renderAsk({ moment: "comment" });

    expect(shownAsk()).toHaveTextContent("Comment posted.");
    expect(shownAsk()).toHaveAccessibleName(
      "Get a browser notification when someone replies?"
    );
  });

  it("asks right after a reply is posted", () => {
    renderAsk({ moment: "reply" });

    expect(shownAsk()).toHaveTextContent("Reply posted.");
    expect(shownAsk()).toHaveAccessibleName(
      "Get a browser notification when someone replies?"
    );
  });

  it("turns push on with Notify me, and snoozes the asks with No thanks", async () => {
    const user = userEvent.setup();
    const onNotifyMe = vi.fn();
    const onNoThanks = vi.fn();
    renderAsk({ onNotifyMe, onNoThanks });

    await user.click(screen.getByRole("button", { name: "Notify me" }));
    await user.click(screen.getByRole("button", { name: "No thanks" }));

    expect(onNotifyMe).toHaveBeenCalledOnce();
    expect(onNoThanks).toHaveBeenCalledOnce();
  });

  it("closes without snoozing", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNoThanks = vi.fn();
    renderAsk({ onClose, onNoThanks });

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onNoThanks).not.toHaveBeenCalled();
  });

  it("walks an iPhone or iPad through Add to Home Screen first", async () => {
    const user = userEvent.setup();
    const onShowMeHow = vi.fn();
    renderAsk({ ask: "add-to-home-screen", onShowMeHow });

    expect(shownAsk()).toHaveTextContent(
      "On iPhone and iPad, add Cadence to your Home Screen first."
    );
    expect(
      screen.queryByRole("button", { name: "Notify me" })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show me how" }));
    expect(onShowMeHow).toHaveBeenCalledOnce();
  });

  it.each(["hidden", "snoozed", "blocked"] as const)(
    "asks nothing when the ask is %s",
    (ask) => {
      renderAsk({ ask });

      expect(shownAsk()).not.toBeInTheDocument();
    }
  );
});

describe("AddToHomeScreenSheet", () => {
  it("shows the three steps", () => {
    render(<AddToHomeScreenSheet open onClose={() => {}} />);

    const steps = within(
      screen.getByRole("dialog", { name: "Add Cadence to your Home Screen" })
    ).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      "Tap Share in Safari's toolbar.",
      "Choose Add to Home Screen, then Add.",
      "Open Cadence from your Home Screen and tap Turn on in the Inbox.",
    ]);
  });

  it("closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AddToHomeScreenSheet open onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows nothing when closed", () => {
    render(<AddToHomeScreenSheet open={false} onClose={() => {}} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
