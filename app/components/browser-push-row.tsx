import { BellRing } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { BrowserPushStatus } from "~/lib/notifications/browser-push";

/**
 * The "Browser push in this browser" row at the top of Settings →
 * Notifications. Display only: `useBrowserPush` works out the status and
 * turns push on.
 */
export function BrowserPushRow({
  status,
  turningOn,
  onTurnOn,
}: {
  status: BrowserPushStatus;
  turningOn: boolean;
  onTurnOn: () => void;
}) {
  return (
    <div className="pb-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <BellRing className="size-4 text-muted-foreground" aria-hidden />
        Browser push in this browser
      </div>
      <div className="mt-1 text-sm text-muted-foreground">
        <BrowserPushStatusText status={status} />
      </div>
      {status === "off" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={turningOn}
          onClick={onTurnOn}
        >
          {turningOn ? "Turning on…" : "Turn on browser push"}
        </Button>
      )}
    </div>
  );
}

function BrowserPushStatusText({ status }: { status: BrowserPushStatus }) {
  switch (status) {
    case "on":
      return (
        <p>
          <span className="font-medium text-foreground">
            On in this browser.
          </span>{" "}
          To stop it here, block notifications for Cadence in this browser's
          settings. To stop it everywhere, turn off Push for each event below.
        </p>
      );
    case "blocked":
      return (
        <p>
          <span className="font-medium text-foreground">
            Blocked in this browser.
          </span>{" "}
          To turn it on, allow notifications for this site in your browser's
          site settings, then reload Cadence.
        </p>
      );
    case "off":
      return (
        <p>
          <span className="font-medium text-foreground">
            Off in this browser.
          </span>{" "}
          Your Push switches below only reach browsers where it's on.
        </p>
      );
    case "unsupported":
      return <p>This browser can't get browser push notifications.</p>;
  }
}
