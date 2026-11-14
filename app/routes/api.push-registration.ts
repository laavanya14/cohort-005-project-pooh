import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.push-registration";
import { readNotificationConfig } from "~/lib/notifications/config.server";
import { savePushRegistration } from "~/lib/push-registrations.server";
import {
  getCurrentUserId,
  getPushRegistrationId,
  setPushRegistrationId,
} from "~/lib/session";
import { parseFormData } from "~/lib/validation";

// POST /api/push-registration: the browser sends the token Firebase gave it
// (see registerBrowserForPush in app/lib/notifications/browser-push.ts).
// Cadence stores it for the person signed in, and the session keeps the
// registration's id so signing out can remove it.

const registrationSchema = z.object({
  token: z.string().trim().min(1, "Missing push token").max(4096),
});

export async function action({ request }: Route.ActionArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    throw data("Select a user from the DevUI panel to turn on browser push.", {
      status: 401,
    });
  }

  if (!readNotificationConfig().knock) {
    throw data("Browser push needs Knock, which isn't configured.", {
      status: 404,
    });
  }

  const parsed = parseFormData(await request.formData(), registrationSchema);
  if (!parsed.success) {
    throw data("Missing push token", { status: 400 });
  }

  const registrationId = savePushRegistration({
    userId,
    token: parsed.data.token,
    userAgent: request.headers.get("User-Agent"),
    registrationId: await getPushRegistrationId(request),
  });

  return data(
    { registrationId },
    {
      headers: {
        "Set-Cookie": await setPushRegistrationId(request, registrationId),
      },
    }
  );
}
