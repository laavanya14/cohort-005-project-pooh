import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { users, UserRole } from "~/db/schema";
import { createRecordingTransport } from "~/test/recording-transport";
import { testDb } from "~/test/test-db";
import { notify } from "./notify.server";
import {
  sendNotificationJobs,
  startNotificationOutbox,
} from "./outbox.server";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function later(from: Date, ms: number) {
  return new Date(from.getTime() + ms);
}

/** A reviewer decides a buyer's refund request: one notification to send. */
function notifyBuyer() {
  const [buyer, reviewer] = testDb()
    .insert(users)
    .values([
      { name: "Buyer", email: "buyer@example.com", role: UserRole.Student },
      {
        name: "Reviewer",
        email: "reviewer@example.com",
        role: UserRole.PlatformAdmin,
      },
    ])
    .returning()
    .all();

  testDb().transaction((tx) =>
    notify(tx, {
      workflowKey: "refund-request-decided",
      actorId: reviewer.id,
      recipients: { userIds: [buyer.id] },
      path: "/courses/test-course",
      data: {
        outcome: "approved",
        courseTitle: "Test Course",
        decisionNote: null,
      },
    })
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sending the notification outbox", () => {
  it("retries a send Knock didn't accept with the same idempotency key, and never sends it twice", async () => {
    const knock = createRecordingTransport();
    notifyBuyer();
    const start = new Date();

    knock.failNext();
    await sendNotificationJobs({ transport: knock, now: start });
    await sendNotificationJobs({ transport: knock, now: later(start, MINUTE) });
    await sendNotificationJobs({
      transport: knock,
      now: later(start, 2 * MINUTE),
    });

    expect(knock.attempts).toHaveLength(2);
    expect(knock.attempts[1].idempotencyKey).toBe(
      knock.attempts[0].idempotencyKey
    );
    expect(knock.triggers).toHaveLength(1);
  });

  it("keeps retrying for 24 hours, then marks the job failed, logs it and stops", async () => {
    const knock = createRecordingTransport();
    notifyBuyer();
    const start = new Date();
    knock.failNext(Infinity);

    await sendNotificationJobs({ transport: knock, now: start });
    await sendNotificationJobs({
      transport: knock,
      now: later(start, 23 * HOUR),
    });
    expect(console.error).not.toHaveBeenCalled();

    await sendNotificationJobs({
      transport: knock,
      now: later(start, 24 * HOUR + MINUTE),
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("refund-request-decided")
    );

    await sendNotificationJobs({
      transport: knock,
      now: later(start, 25 * HOUR),
    });
    expect(knock.attempts).toHaveLength(3);
    expect(knock.triggers).toEqual([]);
  });
});

describe("the running notification outbox", () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
  });

  it("sends a notification straight after the action commits", async () => {
    const knock = createRecordingTransport();
    stop = startNotificationOutbox({ transport: knock });

    notifyBuyer();

    await vi.waitFor(() => expect(knock.triggers).toHaveLength(1));
  });

  it("retries a waiting notification about once a minute until Knock accepts it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const knock = createRecordingTransport();
    let now = new Date();
    stop = startNotificationOutbox({ transport: knock, clock: () => now });
    knock.failNext();

    notifyBuyer();
    // vi.waitFor polls with setInterval, which is faked here.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(knock.attempts).toHaveLength(1);

    now = later(now, MINUTE + 1000);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(knock.triggers).toHaveLength(1);
    expect(knock.triggers[0].idempotencyKey).toBe(
      knock.attempts[0].idempotencyKey
    );

    now = later(now, 5 * MINUTE);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(knock.attempts).toHaveLength(2);
  });

  it("never lets a failing send reach the action", async () => {
    const knock = createRecordingTransport();
    knock.failNext(Infinity);
    stop = startNotificationOutbox({ transport: knock });

    expect(() => notifyBuyer()).not.toThrow();
    await vi.waitFor(() => expect(knock.attempts).toHaveLength(1));
  });
});
