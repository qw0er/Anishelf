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
			new URL(
				"../../../../migrations/0010_unified_subscriptions.sql",
				import.meta.url,
			),
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
			new URL(
				"../../../../migrations/0012_subscription_lifecycle.sql",
				import.meta.url,
			),
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

test("WI17 removes only automatic profile bindings and retains ownership, history and authorization", async () => {
	const db = new Database(":memory:");
	try {
		db.exec(`
   CREATE TABLE acquisition_subscriptions (work_key TEXT PRIMARY KEY, created_by TEXT, profile_id TEXT, automatic TEXT, start_episode INTEGER, enabled INTEGER, watching_account_id TEXT, completion TEXT, source_input TEXT, revision TEXT);
   CREATE TABLE acquisition_watching_policy (id TEXT PRIMARY KEY, value TEXT);
   CREATE TABLE acquisition_watching_members (work_key TEXT, excluded INTEGER, paused INTEGER);
   CREATE TABLE acquisition_authorizations (work_key TEXT, destination_revision TEXT);
   CREATE TABLE acquisition_candidates (id TEXT, work_key TEXT, selection TEXT);
   CREATE TABLE acquisition_download_intents (id TEXT, state TEXT);
   INSERT INTO acquisition_subscriptions VALUES
    ('old', 'watching', 'custom:old-default', '{"profileFingerprint":"old","sourceGeneration":"site","target":{"destinationRevision":"dest"},"retryAt":0}', 4, 1, 'owner', NULL, NULL, 'r1'),
    ('paused', 'watching', 'builtin:general', NULL, 7, 0, 'owner', '{"episodeCount":12,"completedAt":1}', '{"kind":"search","providerId":"site"}', 'r2'),
    ('manual-pin', NULL, 'custom:old-default', '{"profileFingerprint":"old"}', 2, 1, NULL, NULL, NULL, 'r3'),
    ('manual-default', NULL, NULL, NULL, 1, 1, NULL, NULL, NULL, 'r4');
   INSERT INTO acquisition_watching_policy VALUES ('default', '{"enabled":true,"revision":"policy","grant":{"id":"grant","accountId":"owner","backlog":"progress","profileId":"custom:old-default","profileFingerprint":"old","sourceRevision":"site","destinationRevision":"dest"}}');
   INSERT INTO acquisition_watching_members VALUES ('paused', 1, 1);
   INSERT INTO acquisition_authorizations VALUES ('old', 'dest');
   INSERT INTO acquisition_candidates VALUES ('candidate', 'old', '{"profileId":"custom:old-default"}');
   INSERT INTO acquisition_download_intents VALUES ('reserved', 'pending'), ('submitted', 'bound');
  `);
		const before = db
			.prepare("SELECT * FROM acquisition_subscriptions ORDER BY work_key")
			.all() as Record<string, unknown>[];
		const policy = JSON.parse(
			(
				db.prepare("SELECT value FROM acquisition_watching_policy").get() as {
					value: string;
				}
			).value,
		);
		const tables = [
			"acquisition_watching_members",
			"acquisition_authorizations",
			"acquisition_candidates",
			"acquisition_download_intents",
		];
		const history = tables.map((table) =>
			db.prepare(`SELECT * FROM ${table}`).all(),
		);
		const sql = await readFile(
			new URL(
				"../../../../migrations/0021_watching_default_profile.sql",
				import.meta.url,
			),
			"utf8",
		);
		db.transaction(() => db.exec(sql))();
		const expected = before.map((row) => {
			if (row.created_by !== "watching") return row;
			const automatic = row.automatic
				? JSON.parse(row.automatic as string)
				: null;
			if (automatic) delete automatic.profileFingerprint;
			return {
				...row,
				profile_id: null,
				automatic: automatic ? JSON.stringify(automatic) : null,
			};
		});
		expect(
			db
				.prepare("SELECT * FROM acquisition_subscriptions ORDER BY work_key")
				.all(),
		).toEqual(expected);
		delete policy.grant.profileId;
		delete policy.grant.profileFingerprint;
		expect(
			JSON.parse(
				(
					db.prepare("SELECT value FROM acquisition_watching_policy").get() as {
						value: string;
					}
				).value,
			),
		).toEqual(policy);
		expect(
			tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all()),
		).toEqual(history);
		// Reapplying is harmless and cannot reactivate paused records.
		db.exec(sql);
		expect(
			db
				.prepare("SELECT * FROM acquisition_subscriptions ORDER BY work_key")
				.all(),
		).toEqual(expected);
	} finally {
		db.close();
	}
});

test("WI18 initializes schedules lazily without changing accepted subscription state", async () => {
	const db = new Database(":memory:");
	try {
		db.exec(
			"CREATE TABLE acquisition_subscriptions (work_key TEXT PRIMARY KEY, revision TEXT, start_episode INTEGER, enabled INTEGER, created_by TEXT); INSERT INTO acquisition_subscriptions VALUES ('manual','manual-r',3,0,NULL),('watching','auto-r',5,1,'watching')",
		);
		const before = db
			.prepare("SELECT * FROM acquisition_subscriptions ORDER BY work_key")
			.all();
		const sql = await readFile(
			new URL(
				"../../../../migrations/0022_subscription_airing_schedule.sql",
				import.meta.url,
			),
			"utf8",
		);
		db.exec(sql);
		expect(
			db
				.prepare("SELECT * FROM acquisition_subscriptions ORDER BY work_key")
				.all(),
		).toEqual(before.map((row) => ({ ...(row as object), schedule: null })));
	} finally {
		db.close();
	}
});

test("D14 migration preserves download state and protects legacy catalog decisions", async () => {
	const db = new Database(":memory:");
	try {
		db.exec(
			"CREATE TABLE acquisition_intents (id TEXT PRIMARY KEY, work_key TEXT, episode INTEGER, state TEXT); CREATE TABLE catalog_reviews (id TEXT PRIMARY KEY,decision TEXT,reason TEXT); INSERT INTO acquisition_intents VALUES ('download','work',3,'bound'); INSERT INTO catalog_reviews VALUES ('manual','confirmed','User choice'),('pending','pending','download_target_conflict'),('rejected','rejected','Manual rejection');",
		);
		const tasks = db.prepare("SELECT * FROM acquisition_intents").all(),
			reviews = db.prepare("SELECT * FROM catalog_reviews ORDER BY id").all();
		const sql = await readFile(
			new URL(
				"../../../../migrations/0023_accepted_acquisition_targets.sql",
				import.meta.url,
			),
			"utf8",
		);
		db.exec(sql);
		expect(db.prepare("SELECT * FROM acquisition_intents").all()).toEqual(
			tasks.map((row) => ({ ...(row as object), accepted_target: null })),
		);
		expect(
			db.prepare("SELECT * FROM catalog_reviews ORDER BY id").all(),
		).toEqual(
			reviews.map((row) => ({
				...(row as object),
				decision_origin: "legacy",
				acquisition: null,
			})),
		);
	} finally {
		db.close();
	}
});
