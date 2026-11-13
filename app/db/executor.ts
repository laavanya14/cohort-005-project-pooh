import type { RunResult } from "better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./schema";

/**
 * The app's database, or a transaction already open on it.
 *
 * Shared domain functions take one of these as their last argument, defaulting
 * to `db`, and run their writes in `executor.transaction(...)`. Called on their
 * own they open their own transaction; called with a caller's transaction they
 * join it (as a savepoint), so the caller's writes and theirs commit or roll
 * back together.
 */
export type DbExecutor = BaseSQLiteDatabase<"sync", RunResult, typeof schema>;
