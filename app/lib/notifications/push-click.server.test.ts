import { describe, expect, it } from "vitest";
import { users, UserRole } from "~/db/schema";
import { createRecordingTransport } from "~/test/recording-transport";
import { testDb } from "~/test/test-db";
import { sendNotificationJobs } from "./outbox.server";
import { pushClickRedirect } from "./push-click.server";

function seedPerson(name = "Ada") {
  return testDb()
    .insert(users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

/** A page load at `path` on Cadence, as a push click opens it. */
function pageLoad(path: string) {
  return new Request(`http://localhost:5173${path}`);
}

async function knockAfterSending() {
  const knock = createRecordingTransport();
  await sendNotificationJobs({ transport: knock });
  return knock;
}

describe("clicking a push", () => {
  it("marks the clicked notification's inbox copy read for the person signed in", async () => {
    const ada = seedPerson();

    pushClickRedirect({
      request: pageLoad("/admin/refund-requests?notification=notification-1"),
      userId: ada.id,
    });

    const knock = await knockAfterSending();
    expect(knock.calls).toEqual([
      {
        method: "bulkMarkRead",
        recipientId: String(ada.id),
        key: "notificationId",
        value: "notification-1",
      },
    ]);
  });

  it("redirects to the page without the notification id, keeping the rest of the query", async () => {
    const ada = seedPerson();

    const response = pushClickRedirect({
      request: pageLoad("/courses/intro?tab=reviews&notification=notification-1"),
      userId: ada.id,
    });

    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe("/courses/intro?tab=reviews");
  });

  it("only redirects someone who isn't signed in, marking nothing read", async () => {
    const response = pushClickRedirect({
      request: pageLoad("/team?notification=notification-1"),
      userId: null,
    });

    expect(response?.headers.get("Location")).toBe("/team");
    const knock = await knockAfterSending();
    expect(knock.calls).toEqual([]);
  });

  it("leaves a page load that didn't come from a push alone", async () => {
    const ada = seedPerson();

    const response = pushClickRedirect({
      request: pageLoad("/courses/intro?tab=reviews"),
      userId: ada.id,
    });

    expect(response).toBeNull();
    const knock = await knockAfterSending();
    expect(knock.calls).toEqual([]);
  });
});
