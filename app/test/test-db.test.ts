import { describe, it, expect } from "vitest";
import { db } from "~/db";
import { users, UserRole } from "~/db/schema";
import { testDb } from "~/test/test-db";

// These two tests run in order: the second proves the first one's row is gone.
describe("the test database", () => {
  it("is what app code gets from ~/db", () => {
    testDb()
      .insert(users)
      .values({ name: "Ada", email: "ada@example.com", role: UserRole.Student })
      .run();

    expect(db.select().from(users).all()).toMatchObject([{ name: "Ada" }]);
  });

  it("starts empty in every test", () => {
    expect(db.select().from(users).all()).toEqual([]);
  });
});

describe("the test environment", () => {
  it("has no Knock keys, so no test can reach Knock", () => {
    expect(process.env.KNOCK_SECRET_KEY).toBeUndefined();
    expect(process.env.KNOCK_API_KEY).toBeUndefined();
  });
});
