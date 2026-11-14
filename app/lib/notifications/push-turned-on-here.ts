// This browser's local-storage record of which people turned on push in it,
// so one of them is registered again, without asking, when they sign back in
// (use-push-upkeep.ts). Someone else on the same browser isn't registered
// until they turn push on themselves.

const STORAGE_KEY = "cadence-push-turned-on";

/** The part of the browser's local storage this needs. */
type PushStorage = Pick<Storage, "getItem" | "setItem">;

/** The browser's local storage, or null where there's none (the server, or blocked). */
function browserStorage(): PushStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function peopleIn(storage: PushStorage): number[] {
  try {
    const stored: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((id): id is number => typeof id === "number")
      : [];
  } catch {
    return [];
  }
}

/** Remembers that this person turned on push in this browser. */
export function rememberPushTurnedOnHere(
  userId: number,
  storage: PushStorage | null = browserStorage()
) {
  if (!storage) return;
  const people = peopleIn(storage);
  if (people.includes(userId)) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([...people, userId]));
  } catch {
    // Full or blocked storage: they'll be asked again rather than registered.
  }
}

/** Whether this person turned on push in this browser before. */
export function pushWasTurnedOnHere(
  userId: number,
  storage: PushStorage | null = browserStorage()
) {
  return !!storage && peopleIn(storage).includes(userId);
}
