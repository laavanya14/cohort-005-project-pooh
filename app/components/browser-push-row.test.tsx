// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserPushRow } from "./browser-push-row";
import { browserPushStatus } from "~/lib/notifications/browser-push";

describe("the Browser push in this browser row", () => {
  it("says push is on, and how to stop it", () => {
    render(<BrowserPushRow status="on" turningOn={false} onTurnOn={vi.fn()} />);

    expect(screen.getByText("Browser push in this browser")).toBeVisible();
    expect(screen.getByText(/On in this browser/)).toBeVisible();
    expect(screen.getByText(/block notifications for Cadence/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says push is blocked, and how to unblock it", () => {
    render(
      <BrowserPushRow status="blocked" turningOn={false} onTurnOn={vi.fn()} />
    );

    expect(screen.getByText(/Blocked in this browser/)).toBeVisible();
    expect(screen.getByText(/allow notifications for this site/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers to turn push on when it's off", async () => {
    const onTurnOn = vi.fn();
    render(<BrowserPushRow status="off" turningOn={false} onTurnOn={onTurnOn} />);

    expect(screen.getByText(/Off in this browser/)).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Turn on browser push" })
    );
    expect(onTurnOn).toHaveBeenCalledOnce();
  });

  it("can't be pressed twice while push is turning on", () => {
    render(<BrowserPushRow status="off" turningOn onTurnOn={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Turning on/ })).toBeDisabled();
  });

  it("says when this browser can't do push", () => {
    render(
      <BrowserPushRow status="unsupported" turningOn={false} onTurnOn={vi.fn()} />
    );

    expect(screen.getByText(/can't get browser push/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("which state the row shows", () => {
  it("is on when this browser is registered for the person and allowed to notify", () => {
    expect(
      browserPushStatus({ registeredHere: true, permission: "granted" })
    ).toBe("on");
  });

  it("is blocked when the browser blocks Cadence's notifications, registered or not", () => {
    expect(
      browserPushStatus({ registeredHere: false, permission: "denied" })
    ).toBe("blocked");
    expect(
      browserPushStatus({ registeredHere: true, permission: "denied" })
    ).toBe("blocked");
  });

  it("is off when allowed but registered for nobody here, such as after someone else signed out", () => {
    expect(
      browserPushStatus({ registeredHere: false, permission: "granted" })
    ).toBe("off");
    expect(
      browserPushStatus({ registeredHere: false, permission: "default" })
    ).toBe("off");
  });

  it("goes by the server until the browser has been checked", () => {
    expect(browserPushStatus({ registeredHere: true, permission: null })).toBe(
      "on"
    );
    expect(browserPushStatus({ registeredHere: false, permission: null })).toBe(
      "off"
    );
  });

  it("is unsupported when the browser has no push", () => {
    expect(
      browserPushStatus({ registeredHere: false, permission: "unsupported" })
    ).toBe("unsupported");
  });
});
