import { sql } from "drizzle-orm";
import {
	check,
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
		seeders: integer("seeders"),
		seedersObservedAt: integer("seeders_observed_at"),
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
