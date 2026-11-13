import { createTestDb } from "./setup";

/**
 * The stand-in for `~/db` in every test.
 *
 * `app/test/vitest.setup.ts` mocks `~/db` with this module, so every domain
 * function that imports `db` from `~/db` runs against a fresh in-memory
 * database (built by `createTestDb` from the real migrations). The database
 * is created on first use in a test and thrown away after it, so data never
 * leaks between tests. Nothing to set up in a test file: just seed what the
 * test needs through `testDb()`, e.g. `seedBaseData(testDb())`, then call the
 * domain function.
 */
let current: ReturnType<typeof createTestDb> | undefined;

/** This test's database. Seed it, or read back what a domain function wrote. */
export function testDb() {
  current ??= createTestDb();
  return current;
}

/** Throws away this test's database. The Vitest setup runs it after each test. */
export function resetTestDb() {
  current?.$client.close();
  current = undefined;
}

export function getSqlite() {
  return testDb().$client;
}

export const db = new Proxy({} as ReturnType<typeof createTestDb>, {
  get(_target, prop) {
    const target = testDb();
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
