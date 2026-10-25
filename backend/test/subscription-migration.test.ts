import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";
import { expect, test } from "vitest";

test("unification preserves manual permissions, pins, candidates and frozen scope while requiring old managed grants to be renewed", async () => {
	const db = new Database(":memory:");
	try {
		db.exec(`
   CREATE TABLE acquisition_subscriptions (last_error TEXT, last_error_present INTEGER NOT NULL, work_key TEXT PRIMARY KEY NOT NULL, feed_id TEXT NOT NULL, source_input TEXT, start_episode INTEGER NOT NULL, profile_id TEXT, enabled INTEGER NOT NULL, revision TEXT NOT NULL);
   CREATE TABLE acquisition_authorizations (work_key TEXT PRIMARY KEY, feed_id TEXT, start_episode INTEGER, destination_revision TEXT, connection_generation TEXT);
   CREATE TABLE acquisition_watching_members (account_id TEXT, work_key TEXT, subscription_revision TEXT, grant_id TEXT, excluded INTEGER, paused INTEGER);
   CREATE TABLE acquisition_watching_policy (id TEXT PRIMARY KEY, value TEXT);
   CREATE TABLE acquisition_candidates (id TEXT PRIMARY KEY, work_key TEXT REFERENCES acquisition_subscriptions(work_key) ON DELETE CASCADE);
   INSERT INTO acquisition_subscriptions VALUES (NULL, 0, 'manual', 'feed-manual', NULL, 2, 'builtin:general', 1, 'manual-revision');
   INSERT INTO acquisition_subscriptions VALUES (NULL, 0, 'watching', 'feed-pinned', '{"kind":"search","providerId":"site"}', 4, 'builtin:general', 1, 'watching-revision');
   INSERT INTO acquisition_authorizations VALUES ('manual', 'feed-manual', 2, 'dest', 'client'), ('watching', 'feed-pinned', 4, 'dest', 'client');
   INSERT INTO acquisition_watching_members VALUES ('account', 'watching', 'watching-revision', 'grant', 0, 1), ('account', 'excluded', NULL, NULL, 1, 0);
   INSERT INTO acquisition_watching_policy VALUES ('default', '{"revision":"old","enabled":true,"grant":{"id":"grant"}}');
   INSERT INTO acquisition_candidates VALUES ('candidate', 'watching');
  `);
		const sql = await readFile(
			new URL("../migrations/0010_unified_subscriptions.sql", import.meta.url),
			"utf8",
		);
		db.pragma("foreign_keys = OFF");
		db.transaction(() => db.exec(sql))();
		db.pragma("foreign_keys = ON");
		expect(
			db
				.prepare(
					"SELECT feed_id, start_episode, enabled, last_error, created_by FROM acquisition_subscriptions WHERE work_key = 'watching'",
				)
				.get(),
		).toEqual({
			feed_id: "feed-pinned",
			start_episode: 4,
			enabled: 0,
			last_error: "authorization_required",
			created_by: "watching",
		});
		expect(
			db
				.prepare(
					"SELECT enabled FROM acquisition_subscriptions WHERE work_key = 'manual'",
				)
				.get(),
		).toEqual({ enabled: 1 });
		expect(
			db.prepare("SELECT work_key FROM acquisition_authorizations").all(),
		).toEqual([{ work_key: "manual" }]);
		expect(db.prepare("SELECT id FROM acquisition_candidates").all()).toEqual([
			{ id: "candidate" },
		]);
		expect(
			db
				.prepare(
					"SELECT excluded FROM acquisition_watching_members WHERE work_key = 'excluded'",
				)
				.get(),
		).toEqual({ excluded: 1 });
		const policy = db
			.prepare("SELECT value FROM acquisition_watching_policy")
			.get() as { value: string };
		expect(JSON.parse(policy.value)).toMatchObject({
			enabled: false,
			grant: null,
		});
		expect(db.pragma("foreign_key_check")).toEqual([]);
	} finally {
		db.close();
	}
});

test("lifecycle migration binds only unambiguous automatic ownership and preserves manual state and old pauses", async () => {
	const db = new Database(":memory:");
	try {
		db.exec(`
			CREATE TABLE acquisition_subscriptions (work_key TEXT PRIMARY KEY, created_by TEXT, enabled INTEGER, revision TEXT);
			CREATE TABLE acquisition_watching_members (account_id TEXT, work_key TEXT, excluded INTEGER, paused INTEGER);
			CREATE TABLE acquisition_watching_policy (id TEXT PRIMARY KEY, value TEXT);
			INSERT INTO acquisition_watching_policy VALUES ('default', '{"grant":{"accountId":"current"}}');
			INSERT INTO acquisition_subscriptions VALUES ('manual', NULL, 0, 'manual'), ('managed', 'watching', 1, 'managed'), ('paused', 'watching', 0, 'paused'), ('ambiguous', 'watching', 1, 'ambiguous'), ('unrecorded', 'watching', 1, 'unrecorded');
			INSERT INTO acquisition_watching_members VALUES ('owner', 'managed', 0, 0), ('owner', 'paused', 0, 0), ('one', 'ambiguous', 0, 0), ('two', 'ambiguous', 0, 0);
		`);
		const sql = await readFile(
			new URL("../migrations/0012_subscription_lifecycle.sql", import.meta.url),
			"utf8",
		);
		db.transaction(() => db.exec(sql))();
		expect(
			db
				.prepare(
					"SELECT work_key, enabled, watching_account_id FROM acquisition_subscriptions ORDER BY work_key",
				)
				.all(),
		).toEqual([
			{ work_key: "ambiguous", enabled: 1, watching_account_id: null },
			{ work_key: "managed", enabled: 1, watching_account_id: "owner" },
			{ work_key: "manual", enabled: 0, watching_account_id: null },
			{ work_key: "paused", enabled: 1, watching_account_id: "owner" },
			{ work_key: "unrecorded", enabled: 1, watching_account_id: "current" },
		]);
		expect(
			db
				.prepare(
					"SELECT excluded, paused FROM acquisition_watching_members WHERE work_key = 'paused'",
				)
				.get(),
		).toEqual({ excluded: 1, paused: 0 });
		expect(
			db
				.prepare(
					"SELECT completion FROM acquisition_subscriptions WHERE work_key = 'managed'",
				)
				.get(),
		).toEqual({ completion: null });
	} finally {
		db.close();
	}
});
