import { Outlet } from "react-router";
import type { Route } from "./+types/layout.app";
import { Sidebar } from "~/components/sidebar";
import { DevUI } from "~/components/dev-ui";
import { Inbox } from "~/components/inbox/inbox";
import { Toaster } from "sonner";
import { PushAsksProvider } from "~/components/push-asks-provider";
import {
  getCurrentUserId,
  getDevCountry,
  getPushRegistrationId,
} from "~/lib/session";
import { isRegisteredForPush } from "~/lib/push-registrations.server";
import { readNotificationConfig } from "~/lib/notifications/config.server";
import { getNotificationTransport } from "~/lib/notifications/create-transport.server";
import { listNotificationPreferences } from "~/lib/notifications/preferences.server";
import { isPushOffForEveryEvent } from "~/lib/notifications/push-ask";
import { getCountryTierInfo, COUNTRIES } from "~/lib/ppp";
import { eq, and, or, sql, desc } from "drizzle-orm";
import { db } from "~/db";
import {
  users,
  courses,
  modules,
  lessons,
  lessonProgress,
  teams,
  teamMembers,
  TeamMemberRole,
  LessonProgressStatus,
} from "~/db/schema";

function getAllUsers() {
  return db.select().from(users).all();
}

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

function getTeamForAdmin(userId: number) {
  const membership = db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.TeamAdmin)
      )
    )
    .get();

  if (!membership) return undefined;

  return db.select().from(teams).where(eq(teams.id, membership.teamId)).get();
}

function isTeamAdmin(userId: number) {
  return !!getTeamForAdmin(userId);
}

function getCourseLessonIds(courseId: number): number[] {
  const courseModules = db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .all();

  if (courseModules.length === 0) return [];

  const courseLessons = db
    .select({ id: lessons.id })
    .from(lessons)
    .where(or(...courseModules.map((m) => eq(lessons.moduleId, m.id)))!)
    .all();

  return courseLessons.map((l) => l.id);
}

function calculateProgress(
  userId: number,
  courseId: number,
  weightByDuration: boolean
) {
  const lessonIds = getCourseLessonIds(courseId);

  if (lessonIds.length === 0) return 0;

  if (weightByDuration) {
    const courseLessons = db
      .select({
        id: lessons.id,
        durationMinutes: lessons.durationMinutes,
      })
      .from(lessons)
      .where(or(...lessonIds.map((id) => eq(lessons.id, id)))!)
      .all();

    const totalDuration = courseLessons.reduce(
      (sum, l) => sum + (l.durationMinutes ?? 1),
      0
    );

    if (totalDuration === 0) return 0;

    const completed = db
      .select()
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.status, LessonProgressStatus.Completed),
          or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))!
        )
      )
      .all();

    const completedIds = new Set(completed.map((p) => p.lessonId));

    const completedDuration = courseLessons
      .filter((l) => completedIds.has(l.id))
      .reduce((sum, l) => sum + (l.durationMinutes ?? 1), 0);

    return Math.round((completedDuration / totalDuration) * 100);
  }

  const completedCount = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))!
      )
    )
    .get();

  return Math.round(((completedCount?.count ?? 0) / lessonIds.length) * 100);
}

function getCompletedLessonCount(userId: number, courseId: number) {
  const lessonIds = getCourseLessonIds(courseId);
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))!
      )
    )
    .get();

  return result?.count ?? 0;
}

function getTotalLessonCount(courseId: number) {
  return getCourseLessonIds(courseId).length;
}

function getRecentlyProgressedCourses(userId: number, limit: number = 3) {
  return db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      coverImageUrl: courses.coverImageUrl,
      lastActivityId: sql<number>`max(${lessonProgress.id})`,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessonProgress.userId, userId))
    .groupBy(courses.id)
    .orderBy(desc(sql`max(${lessonProgress.id})`))
    .limit(limit)
    .all();
}

export async function loader({ request }: Route.LoaderArgs) {
  const users = getAllUsers();
  const currentUserId = await getCurrentUserId(request);
  const currentUser = currentUserId ? getUserById(currentUserId) : null;
  const devCountry = await getDevCountry(request);
  const countryTierInfo = getCountryTierInfo(devCountry);

  const recentCourses = currentUserId
    ? getRecentlyProgressedCourses(currentUserId).map((course) => {
        const completedLessons = getCompletedLessonCount(
          currentUserId,
          course.courseId
        );
        const totalLessons = getTotalLessonCount(course.courseId);
        const progress = calculateProgress(currentUserId, course.courseId, false);
        return {
          courseId: course.courseId,
          title: course.courseTitle,
          slug: course.courseSlug,
          coverImageUrl: course.coverImageUrl,
          completedLessons,
          totalLessons,
          progress,
        };
      })
    : [];

  return {
    users: users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    currentUser: currentUser
      ? {
          id: currentUser.id,
          name: currentUser.name,
          role: currentUser.role,
          avatarUrl: currentUser.avatarUrl ?? null,
        }
      : null,
    recentCourses,
    devCountry,
    countryTierInfo,
    countries: COUNTRIES,
    isTeamAdmin: currentUserId ? isTeamAdmin(currentUserId) : false,
    pushAsks: currentUserId ? await pushAskFacts(request, currentUserId) : null,
  };
}

/**
 * What the server knows for the push asks. Whether push is off for every
 * event comes from Knock, so it's streamed: no page waits on Knock for it.
 */
async function pushAskFacts(request: Request, userId: number) {
  const registeredHere = isRegisteredForPush({
    userId,
    registrationId: await getPushRegistrationId(request),
  });
  // Without Knock there are no asks, so there's nothing to read.
  const needsPreferences =
    !registeredHere && readNotificationConfig().knock !== null;

  return {
    registeredHere,
    pushOffForEveryEvent: needsPreferences
      ? listNotificationPreferences(getNotificationTransport(), userId)
          .then(isPushOffForEveryEvent)
          .catch((error: unknown) => {
            // The asks still show; the Settings row works either way.
            console.error(
              "[notifications] Couldn't read notification preferences:",
              error
            );
            return false;
          })
      : Promise.resolve(false),
  };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const {
    users,
    currentUser,
    recentCourses,
    devCountry,
    countryTierInfo,
    countries,
    isTeamAdmin: userIsTeamAdmin,
    pushAsks,
  } = loaderData;

  const page = (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        currentUser={currentUser}
        recentCourses={recentCourses}
        isTeamAdmin={userIsTeamAdmin}
        inbox={currentUser ? <Inbox userId={currentUser.id} /> : undefined}
      />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <DevUI
        users={users}
        currentUser={currentUser}
        devCountry={devCountry}
        countryTierInfo={countryTierInfo}
        countries={countries}
      />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );

  if (!currentUser || !pushAsks) return page;

  return (
    <PushAsksProvider
      userId={currentUser.id}
      role={currentUser.role}
      registeredHere={pushAsks.registeredHere}
      pushOffForEveryEvent={pushAsks.pushOffForEveryEvent}
    >
      {page}
    </PushAsksProvider>
  );
}
