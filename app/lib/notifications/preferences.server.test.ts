import { describe, expect, it } from "vitest";
import { users, UserRole } from "~/db/schema";
import { createRecordingTransport } from "~/test/recording-transport";
import { seedBaseData } from "~/test/setup";
import { testDb } from "~/test/test-db";
import {
  listNotificationPreferences,
  setNotificationPreference,
} from "./preferences.server";

function seedPlatformAdmin() {
  return testDb()
    .insert(users)
    .values({
      name: "Platform Admin",
      email: "admin@example.com",
      role: UserRole.PlatformAdmin,
    })
    .returning()
    .get();
}

describe("notification preferences", () => {
  describe("the rows each person sees, everything on until they change it", () => {
    it("shows a student refund request decided with Push only, and replies to them with Push and Email", async () => {
      const { user: student } = seedBaseData(testDb());
      const knock = createRecordingTransport();

      expect(await listNotificationPreferences(knock, student.id)).toEqual([
        {
          workflowKey: "refund-request-decided",
          label: "Refund request decided",
          switches: { push: true },
        },
        {
          workflowKey: "instructor-or-platform-admin-reply",
          label: "A reply from the instructor or a platform admin",
          switches: { push: true, email: true },
        },
      ]);
    });

    it("shows an instructor students' questions and replies from a platform admin, with Push and Email", async () => {
      const { instructor } = seedBaseData(testDb());
      const knock = createRecordingTransport();

      expect(await listNotificationPreferences(knock, instructor.id)).toEqual([
        {
          workflowKey: "student-top-level-comment",
          label: "A student's question",
          switches: { push: true, email: true },
        },
        {
          workflowKey: "instructor-or-platform-admin-reply",
          label: "A reply from a platform admin",
          switches: { push: true, email: true },
        },
      ]);
    });

    it("shows a platform admin new open refund requests with Push only", async () => {
      const platformAdmin = seedPlatformAdmin();
      const knock = createRecordingTransport();

      expect(await listNotificationPreferences(knock, platformAdmin.id)).toEqual(
        [
          {
            workflowKey: "new-open-refund-request",
            label: "New open refund request",
            switches: { push: true },
          },
        ]
      );
    });
  });

  describe("saving a change", () => {
    it("turns one channel off in Knock and shows it off afterwards", async () => {
      const { user: student } = seedBaseData(testDb());
      const knock = createRecordingTransport();

      await setNotificationPreference(knock, student.id, {
        workflowKey: "instructor-or-platform-admin-reply",
        channel: "email",
        on: false,
      });

      expect(knock.preferenceChanges).toEqual([
        {
          userId: String(student.id),
          changes: { "instructor-or-platform-admin-reply": { email: false } },
        },
      ]);
      const [, replies] = await listNotificationPreferences(knock, student.id);
      expect(replies?.switches).toEqual({ push: true, email: false });
    });

    it("turns a channel back on", async () => {
      const platformAdmin = seedPlatformAdmin();
      const knock = createRecordingTransport();
      const change = {
        workflowKey: "new-open-refund-request",
        channel: "push",
      } as const;

      await setNotificationPreference(knock, platformAdmin.id, {
        ...change,
        on: false,
      });
      await setNotificationPreference(knock, platformAdmin.id, {
        ...change,
        on: true,
      });

      const [row] = await listNotificationPreferences(knock, platformAdmin.id);
      expect(row?.switches).toEqual({ push: true });
    });
  });

  describe("refusing changes", () => {
    it.each(["refund-request-decided", "issued-refund", "failed-refund"])(
      "refuses to turn off email for %s, which is about a buyer's money",
      async (workflowKey) => {
        const { user: student } = seedBaseData(testDb());
        const knock = createRecordingTransport();

        await expect(
          setNotificationPreference(knock, student.id, {
            workflowKey,
            channel: "email",
            on: false,
          })
        ).rejects.toMatchObject({
          data: "Email about a refund request or a refund can't be turned off.",
          init: { status: 400 },
        });

        expect(knock.preferenceChanges).toEqual([]);
      }
    );

    it("refuses a change to a row the person doesn't have", async () => {
      const { user: student } = seedBaseData(testDb());
      const knock = createRecordingTransport();

      await expect(
        setNotificationPreference(knock, student.id, {
          workflowKey: "student-top-level-comment",
          channel: "push",
          on: false,
        })
      ).rejects.toMatchObject({ init: { status: 400 } });

      await expect(
        setNotificationPreference(knock, student.id, {
          workflowKey: "student-reply",
          channel: "push",
          on: false,
        })
      ).rejects.toMatchObject({ init: { status: 400 } });

      expect(knock.preferenceChanges).toEqual([]);
    });
  });
});
