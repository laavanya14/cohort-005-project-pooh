import { useEffect } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { AlertTriangle } from "lucide-react";
import type { Route } from "./+types/admin.refund-requests";
import { db } from "~/db";
import { UserRole, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import {
  approveRefundRequest,
  declineRefundRequest,
  listRefundRequestsForReview,
} from "~/lib/refund-requests.server";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

// Where a reviewer approves or declines refund requests (see GLOSSARY.md).

const decisionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("approve"),
    refundRequestId: z.coerce.number().int(),
    decisionNote: z.string().trim().max(1000).optional(),
  }),
  z.object({
    intent: z.literal("decline"),
    refundRequestId: z.coerce.number().int(),
    decisionNote: z
      .string()
      .trim()
      .min(1, "Write a decision note to decline a refund request.")
      .max(1000, "Please keep your decision note under 1000 characters."),
  }),
]);

async function requireReviewer(request: Request) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to review refund requests.", {
      status: 401,
    });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can review refund requests.", { status: 403 });
  }

  return currentUser;
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or decline refund requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireReviewer(request);
  return listRefundRequestsForReview();
}

export async function action({ request }: Route.ActionArgs) {
  const reviewer = await requireReviewer(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, decisionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { intent, refundRequestId, decisionNote } = parsed.data;

  if (intent === "approve") {
    approveRefundRequest(reviewer.id, refundRequestId, decisionNote || null);
  } else {
    declineRefundRequest(reviewer.id, refundRequestId, decisionNote);
  }

  return { decided: intent };
}

type RefundRequestRow = Route.ComponentProps["loaderData"]["open"][number];

export default function AdminRefundRequests({
  loaderData,
}: Route.ComponentProps) {
  const { open, decided } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Approving a refund request refunds the amount paid and ends the
          student's access to the course. Declining needs a decision note.
        </p>
      </div>

      <h2 className="mb-4 text-lg font-semibold">
        Open ({open.length})
      </h2>
      {open.length === 0 ? (
        <p className="mb-8 text-sm text-muted-foreground">
          No refund requests are waiting for a decision.
        </p>
      ) : (
        <div className="mb-8 grid max-w-3xl gap-4">
          {open.map((request) => (
            <OpenRefundRequest key={request.id} request={request} />
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <>
          <h2 className="mb-4 text-lg font-semibold">Recently decided</h2>
          <div className="grid max-w-3xl gap-2">
            {decided.map((request) => (
              <div
                key={request.id}
                className="rounded-md border p-3 text-sm text-muted-foreground"
              >
                <span className="font-medium text-foreground">
                  {request.studentName}
                </span>{" "}
                · {request.courseTitle} · {formatPrice(request.refundableAmount)}{" "}
                · <span className="capitalize">{request.status}</span>
                {request.decisionNote && <> — {request.decisionNote}</>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OpenRefundRequest({ request }: { request: RefundRequestRow }) {
  const fetcher = useFetcher<{ error?: string; decided?: string }>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
    if (fetcher.state === "idle" && fetcher.data?.decided) {
      toast.success(`Refund request ${fetcher.data.decided}d.`);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">
              {request.studentName}{" "}
              <span className="font-normal text-muted-foreground">
                ({request.studentEmail})
              </span>
            </p>
            <Link
              to={`/courses/${request.courseSlug}`}
              className="text-sm hover:underline"
            >
              {request.courseTitle}
            </Link>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">
              {formatPrice(request.refundableAmount)}
            </p>
            <p className="text-muted-foreground">
              requested {new Date(request.requestedAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          <span className="font-medium">Reason:</span> {request.reason}
        </p>
        <fetcher.Form method="post" className="space-y-2">
          <input type="hidden" name="refundRequestId" value={request.id} />
          <Textarea
            name="decisionNote"
            rows={2}
            placeholder="Decision note — required to decline, optional to approve"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              name="intent"
              value="approve"
              size="sm"
              disabled={isSubmitting}
            >
              Approve
            </Button>
            <Button
              type="submit"
              name="intent"
              value="decline"
              variant="outline"
              size="sm"
              disabled={isSubmitting}
            >
              Decline
            </Button>
          </div>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refund requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only admins can review refund requests.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
