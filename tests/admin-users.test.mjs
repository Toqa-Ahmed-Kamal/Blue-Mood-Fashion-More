import test from "node:test";
import assert from "node:assert/strict";

process.env.ADMIN_SESSION_SECRET = "u".repeat(40);

import { createAdminSessionToken } from "../lib/admin-auth.ts";
import {
  OWNER_ACCESS,
  accessFromTokens,
  can,
  checkPassword,
  checkUsername,
  cleanPermissions,
  createUserSessionToken,
  hashUserPassword,
  isValidUserToken,
  newUserId,
  parseUser,
  publicUser,
  userIdFromToken,
  verifyUserPassword,
} from "../lib/admin-users.ts";
import { createTeamSessionToken } from "../lib/team-auth.ts";

const user = (extra = {}) => ({ id: "0123456789abcdef", username: "mona", name: "منى", passwordHash: hashUserPassword("secret-123"), permissions: ["orders"], active: true, createdAt: "2026-11-22T10:00:00.000Z", updatedAt: "2026-11-22T10:00:00.000Z", ...extra });

test("usernames, passwords and sections are checked", () => {
  assert.equal(checkUsername("Mona"), null, "lower-cased");
  assert.equal(checkUsername("mona.cs_1"), null);
  assert.ok(checkUsername("mo"));
  assert.ok(checkUsername("منى"));
  assert.ok(checkUsername("mona ali"));
  assert.ok(checkPassword("short"));
  assert.equal(checkPassword("long-enough"), null);
  assert.deepEqual(cleanPermissions(["money", "orders", "admin", "orders"]), ["orders", "money"], "known sections only, in order, once");
  assert.deepEqual(cleanPermissions("orders"), []);
  assert.match(newUserId(), /^[a-f0-9]{16}$/);
});

test("stored users: bad records are dropped; the dashboard never gets the password hash", () => {
  const stored = user();
  assert.deepEqual(parseUser(JSON.stringify(stored)), stored);
  assert.equal(parseUser("{"), null);
  assert.equal(parseUser(JSON.stringify({ ...stored, id: "x" })), null);
  assert.equal(parseUser(JSON.stringify({ ...stored, passwordHash: "plain" })), null);
  assert.deepEqual(parseUser(JSON.stringify({ ...stored, permissions: ["orders", "everything"] })).permissions, ["orders"]);
  assert.equal("passwordHash" in publicUser(stored), false);
  assert.equal(verifyUserPassword("secret-123", stored), true);
  assert.equal(verifyUserPassword("secret-124", stored), false);
});

test("user sessions: signed, expire, and stop working after a new password or turning the user off", () => {
  const now = Date.parse("2026-11-22T10:00:00Z");
  const stored = user();
  const token = createUserSessionToken(stored, now);
  assert.equal(userIdFromToken(token, now), stored.id);
  assert.equal(isValidUserToken(token, stored, now), true);
  assert.equal(isValidUserToken(token, { ...stored, passwordHash: hashUserPassword("another-pass") }, now), false, "new password signs out");
  assert.equal(isValidUserToken(token, { ...stored, active: false }, now), false, "turned off");
  assert.equal(isValidUserToken(token, { ...stored, id: "fedcba9876543210" }, now), false, "another user");
  assert.equal(userIdFromToken(token, now + 8 * 24 * 3600e3), null, "expired after 7 days");
  const parts = token.split(".");
  assert.equal(userIdFromToken([parts[0], "fedcba9876543210", ...parts.slice(2)].join("."), now), null, "id cannot be swapped");
  assert.equal(userIdFromToken(createAdminSessionToken(now), now), null, "the owner's token is not a user token");
  assert.equal(userIdFromToken(createTeamSessionToken(stored.passwordHash, now), now), null, "the team token is not a user token");
});

test("the owner's session is everything; no session is nothing; sections are checked one by one", async () => {
  assert.deepEqual(await accessFromTokens(createAdminSessionToken(), null), OWNER_ACCESS);
  assert.equal(await accessFromTokens("v1.1.bad", null), null);
  assert.equal(await accessFromTokens(null, "u1.bad"), null);
  const staff = { owner: false, name: "منى", username: "mona", userId: "0123456789abcdef", permissions: ["orders"] };
  assert.equal(can(staff, "orders"), true);
  assert.equal(can(staff, "money"), false);
  assert.equal(can(OWNER_ACCESS, "money"), true);
});
