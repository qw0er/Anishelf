import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const acquisitionFeeds = sqliteTable(
	"acquisition_feeds",
	{
		revision: text("revision").notNull(),
		id: text("id").primaryKey().notNull(),
		url: text("url").notNull(),
		etag: text("etag"),
		lastModified: text("last_modified"),
		checkedAt: integer("checked_at"),
		nextAttemptAt: integer("next_attempt_at").notNull(),
		failures: integer("failures").notNull(),
		error: text("error"),
	},
	(table) => [
		check(
			"acquisition_feeds_next_attempt_at_0",
			sql`${table.nextAttemptAt} >= 0`,
		),
		check("acquisition_feeds_failures_0", sql`${table.failures} >= 0`),
	],
);
export const acquisitionFeedsEntries = sqliteTable(
	"acquisition_feeds_entries",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => acquisitionFeeds.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		id: text("id").notNull(),
		observationId: text("observation_id").notNull(),
		title: text("title").notNull(),
		publishedAt: integer("published_at"),
		downloadUrl: text("download_url"),
		hash: text("hash"),
	},
	(table) => [
		check("acquisition_feeds_entries_ordinal", sql`${table.ordinalIndex} >= 0`),
		uniqueIndex("acquisition_feeds_entries_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const acquisitionSubscriptions = sqliteTable(
	"acquisition_subscriptions",
	{
		lastError: text("last_error"),
		lastErrorPresent: integer("last_error_present", {
			mode: "boolean",
		}).notNull(),
		workKey: text("work_key").primaryKey().notNull(),
		feedId: text("feed_id")
			.notNull()
			.references(() => acquisitionFeeds.id, { onDelete: "restrict" }),
		startEpisode: integer("start_episode").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull(),
		revision: text("revision").notNull(),
	},
	(table) => [
		check(
			"acquisition_subscriptions_last_error_present_0",
			sql`${table.lastErrorPresent} IN (0, 1)`,
		),
		check(
			"acquisition_subscriptions_start_episode_0",
			sql`${table.startEpisode} >= 1`,
		),
		check(
			"acquisition_subscriptions_enabled_0",
			sql`${table.enabled} IN (0, 1)`,
		),
		index("acquisition_subscriptions_feed").on(table.feedId),
	],
);
export const acquisitionCandidates = sqliteTable(
	"acquisition_candidates",
	{
		chosen: integer("chosen", { mode: "boolean" }),
		id: text("id").primaryKey().notNull(),
		workKey: text("work_key")
			.notNull()
			.references(() => acquisitionSubscriptions.workKey, {
				onDelete: "cascade",
			}),
		entryId: text("entry_id").notNull(),
		title: text("title").notNull(),
		episode: integer("episode"),
		status: text("status", { enum: ["selected", "skipped"] }).notNull(),
		version: text("version").notNull(),
		snapshotId: text("snapshot_id").notNull(),
		publishedAt: integer("published_at"),
	},
	(table) => [
		check("acquisition_candidates_chosen_0", sql`${table.chosen} IN (0, 1)`),
		check(
			"acquisition_candidates_status_0",
			sql`${table.status} IN ('selected', 'skipped')`,
		),
		index("acquisition_candidates_work").on(table.workKey),
	],
);
export const acquisitionCandidatesReasons = sqliteTable(
	"acquisition_candidates_reasons",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => acquisitionCandidates.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"acquisition_candidates_reasons_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("acquisition_candidates_reasons_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
