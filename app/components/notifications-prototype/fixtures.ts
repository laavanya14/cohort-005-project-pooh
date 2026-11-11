// PROTOTYPE — throwaway. Mock Notifications for "What do the bell and inbox
// look like in Cadence?". Events come from the table in "Which events notify
// whom, and on which channels?". Nothing here touches the DB or Knock.

export type NotificationKind = "waiting" | "about" | "fyi";

export interface MockNotification {
  id: string;
  kind: NotificationKind;
  actor: { name: string; avatarUrl: string | null } | null;
  /** One-line headline, e.g. "Sarah Chen replied to your comment". */
  title: string;
  /** Optional quoted detail (note, comment excerpt, rating). */
  detail?: string;
  context: string; // course / lesson / team the event is about
  at: string; // relative time label
  day: "Today" | "Yesterday" | "Earlier";
  href: string;
  read: boolean;
  push: boolean; // also sent as browser push
  needsPayoutTracking?: boolean;
}

const avatar = (seed: string) =>
  `https://api.dicebear.com/9.x/avataaars/svg?seed=${seed}`;

const student: MockNotification[] = [
  {
    id: "s1",
    kind: "about",
    actor: { name: "Alex Rivera", avatarUrl: avatar("alex") },
    title: "Your Refund Request was approved",
    detail: "Approved — sorry the course wasn't the right fit for you.",
    context: "Building REST APIs with Node.js",
    at: "12m",
    day: "Today",
    href: "/courses/building-rest-apis-with-nodejs",
    read: false,
    push: true,
  },
  {
    id: "s2",
    kind: "about",
    actor: { name: "Sarah Chen", avatarUrl: avatar("sarah") },
    title: "Sarah Chen replied to your comment",
    detail:
      "Good catch — `unknown` is safer than `any` here because you have to narrow it first.",
    context: "Introduction to TypeScript · Primitive Types",
    at: "2h",
    day: "Today",
    href: "/courses/introduction-to-typescript/lessons/4",
    read: false,
    push: true,
  },
  {
    id: "s3",
    kind: "about",
    actor: { name: "James Park", avatarUrl: avatar("james") },
    title: "James Park replied to your comment",
    detail: "Same problem here, restarting the TS server fixed it for me.",
    context: "Introduction to TypeScript · Installing and Configuring TypeScript",
    at: "Yesterday",
    day: "Yesterday",
    href: "/courses/introduction-to-typescript/lessons/2",
    read: false,
    push: false,
  },
  {
    id: "s4",
    kind: "about",
    actor: null,
    title: "Your refund of $49.00 has been issued",
    detail: "It can take 5–10 business days to reach your card.",
    context: "Building REST APIs with Node.js",
    at: "3d",
    day: "Earlier",
    href: "/courses/building-rest-apis-with-nodejs",
    read: true,
    push: true,
    needsPayoutTracking: true,
  },
];

const teamAdmin: MockNotification[] = [
  {
    id: "t1",
    kind: "about",
    actor: { name: "Olivia Martinez", avatarUrl: avatar("olivia") },
    title: "Olivia Martinez claimed a Seat",
    detail: "4 of 5 Seats claimed",
    context: "Team Licence · Design Systems with Tailwind",
    at: "35m",
    day: "Today",
    href: "/team",
    read: false,
    push: false,
  },
  {
    id: "t2",
    kind: "about",
    actor: null,
    title: "All Seats on your Team Licence are claimed",
    detail: "5 of 5 Seats claimed. Buy more Seats to invite anyone else.",
    context: "Team Licence · Design Systems with Tailwind",
    at: "Yesterday",
    day: "Yesterday",
    href: "/team",
    read: true,
    push: false,
  },
];

const instructor: MockNotification[] = [
  {
    id: "i1",
    kind: "waiting",
    actor: { name: "Emma Wilson", avatarUrl: avatar("emma") },
    title: "Emma Wilson asked a question",
    detail:
      "Why does `extends keyof T` work here but `in keyof T` doesn't? I get error 2322.",
    context: "Introduction to TypeScript · Generic Constraints",
    at: "8m",
    day: "Today",
    href: "/instructor/questions",
    read: false,
    push: true,
  },
  {
    id: "i2",
    kind: "waiting",
    actor: { name: "Liam Thompson", avatarUrl: avatar("liam") },
    title: "Liam Thompson asked a question",
    detail: "Is there a reason to prefer `type` over `interface` for props?",
    context: "Introduction to TypeScript · Type Aliases and Interfaces",
    at: "Yesterday",
    day: "Yesterday",
    href: "/instructor/questions",
    read: true,
    push: true,
  },
  {
    id: "i3",
    kind: "fyi",
    actor: { name: "Sophia Davis", avatarUrl: avatar("sophia") },
    title: "Sophia Davis enrolled",
    context: "Design Systems with Tailwind",
    at: "1h",
    day: "Today",
    href: "/instructor/3/students",
    read: false,
    push: false,
  },
  {
    id: "i4",
    kind: "fyi",
    actor: { name: "James Park", avatarUrl: avatar("james") },
    title: "James Park rated your course ★★★★☆",
    detail: "Changed from ★★★☆☆",
    context: "Introduction to TypeScript",
    at: "4h",
    day: "Today",
    href: "/instructor/1",
    read: false,
    push: false,
  },
  {
    id: "i5",
    kind: "fyi",
    actor: null,
    title: "An Enrollment ended after an approved Refund Request",
    context: "Introduction to TypeScript",
    at: "2d",
    day: "Earlier",
    href: "/instructor/1/students",
    read: true,
    push: false,
  },
];

const platformAdmin: MockNotification[] = [
  {
    id: "a1",
    kind: "waiting",
    actor: { name: "Emma Wilson", avatarUrl: avatar("emma") },
    title: "New Refund Request from Emma Wilson",
    detail: "“The pace was too fast for me and I couldn't keep up.”",
    context: "Building REST APIs with Node.js · $49.00",
    at: "15m",
    day: "Today",
    href: "/admin/refunds",
    read: false,
    push: true,
  },
  {
    id: "a2",
    kind: "waiting",
    actor: { name: "James Park", avatarUrl: avatar("james") },
    title: "New Refund Request from James Park",
    detail: "“Bought the wrong course by mistake.”",
    context: "Practical Data Visualisation · $39.00",
    at: "3h",
    day: "Today",
    href: "/admin/refunds",
    read: false,
    push: true,
  },
  {
    id: "a3",
    kind: "waiting",
    actor: null,
    title: "Refund to Olivia Martinez failed",
    detail: "The card was declined by the bank. Contact the buyer if needed.",
    context: "Shipping with Docker and Kubernetes · $59.00",
    at: "Yesterday",
    day: "Yesterday",
    href: "/admin/refunds",
    read: true,
    push: true,
    needsPayoutTracking: true,
  },
  {
    id: "a4",
    kind: "about",
    actor: { name: "Sarah Chen", avatarUrl: avatar("sarah") },
    title: "Sarah Chen replied to your comment",
    detail: "Thanks Alex — I've updated the lesson video.",
    context: "Introduction to TypeScript · What is TypeScript?",
    at: "2d",
    day: "Earlier",
    href: "/courses/introduction-to-typescript/lessons/1",
    read: true,
    push: true,
  },
];

export function notificationsFor(
  role: string | null,
  isTeamAdmin: boolean
): MockNotification[] {
  if (!role) return [];
  if (role === "student")
    return isTeamAdmin
      ? [student[0], teamAdmin[0], student[1], student[2], teamAdmin[1], student[3]]
      : student;
  if (role === "instructor") return instructor;
  return platformAdmin; // "admin" / "platform_admin"
}

export const kindLabel: Record<NotificationKind, string> = {
  waiting: "Waiting on you",
  about: "About you",
  fyi: "Activity",
};
