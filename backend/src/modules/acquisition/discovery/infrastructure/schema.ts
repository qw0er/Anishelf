import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { acquisitionSources } from "../../sources/persistence.js";
import type { Candidate } from "../domain/model.js";
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
			.references(() => acquisitionSources.id, { onDelete: "restrict" }),
		startEpisode: integer("start_episode").notNull(),
		profileId: text("profile_id"),
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
		selection: text("selection", { mode: "json" }).$type<
			Candidate["selection"]
		>(),
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
