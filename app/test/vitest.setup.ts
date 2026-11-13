import { afterEach, vi } from "vitest";
import { resetTestDb } from "./test-db";

// No test can reach Knock, even when the developer's shell or .env has real
// keys: without them the Knock-facing interface does not send anything.
delete process.env.KNOCK_SECRET_KEY;
delete process.env.KNOCK_API_KEY;

// Every test gets its own in-memory database in place of data.db.
// See app/test/test-db.ts.
vi.mock("~/db", () => import("./test-db"));

afterEach(() => {
  resetTestDb();
});
