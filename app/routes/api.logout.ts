import { redirect } from "react-router";
import type { Route } from "./+types/api.logout";
import { signOut } from "~/lib/sign-out.server";

export async function action({ request }: Route.ActionArgs) {
  // Also stops push to this browser for the person signing out.
  const cookie = await signOut(request);

  return redirect("/", {
    headers: { "Set-Cookie": cookie },
  });
}
