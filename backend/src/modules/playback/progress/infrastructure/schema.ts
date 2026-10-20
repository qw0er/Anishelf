import { desc, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { mediaSources } from "../../../resources/persistence.js";

export const playbackProgress = sqliteTable(
	"playback_progress",
	{
		sourceId: text("source_id")
			.primaryKey()
			.references(() => mediaSources.id, { onDelete: "restrict" }),
		positionMs: integer("position_ms").notNull().default(0),
		durationMs: integer("duration_ms"),
		lastViewedAtMs: integer("last_viewed_at_ms"),
		generation: integer("generation").notNull().default(1),
		lastSequence: integer("last_sequence").notNull().default(0),
	},
	(table) => [
		check("progress_position", sql`${table.positionMs} >= 0`),
		check(
			"progress_duration",
			sql`${table.durationMs} IS NULL OR (${table.durationMs} > 0 AND ${table.positionMs} <= ${table.durationMs})`,
		),
		check("progress_generation", sql`${table.generation} >= 1`),
		check("progress_sequence", sql`${table.lastSequence} >= 0`),
		index("progress_recent").on(desc(table.lastViewedAtMs), table.sourceId),
	],
);

export const playbackCompletions = sqliteTable(
	"playback_completions",
	{
		id: text("id").primaryKey().notNull(),
		sourceId: text("source_id")
			.notNull()
			.references(() => mediaSources.id, { onDelete: "restrict" }),
		attemptedAt: integer("attempted_at").notNull(),
		contextVersion: integer("context_version").notNull(),
		contextAccountId: text("context_account_id").notNull(),
		contextGeneration: text("context_generation").notNull(),
		contextManualVersion: integer("context_manual_version").notNull(),
		contextFileId: text("context_file_id").notNull(),
		contextSourceVersion: text("context_source_version").notNull(),
		contextReviewId: text("context_review_id").notNull(),
		contextMappingRevision: integer("context_mapping_revision").notNull(),
		contextEpisodeId: text("context_episode_id").notNull(),
		contextMediaId: text("context_media_id").notNull(),
		contextEpisode: integer("context_episode").notNull(),
		outcomeState: text("outcome_state", {
			enum: ["pending", "accepted", "ignored", "unavailable"],
		}).notNull(),
		outcomeReason: text("outcome_reason").notNull(),
		outcomeOperationId: text("outcome_operation_id"),
		outcomeRevision: integer("outcome_revision"),
	},
	(table) => [
		check("playback_context_version", sql`${table.contextVersion} = 2`),
		check(
			"playback_context_values",
			sql`${table.contextManualVersion} >= 0 AND ${table.contextMappingRevision} >= 0 AND ${table.contextEpisode} >= 1`,
		),
		check(
			"playback_completions_attempted_at_0",
			sql`${table.attemptedAt} >= 0`,
		),
		check(
			"playback_completions_outcome_state_0",
			sql`${table.outcomeState} IN ('pending', 'accepted', 'ignored', 'unavailable')`,
		),
		check(
			"playback_completions_outcome_revision_0",
			sql`${table.outcomeRevision} >= 0`,
		),
		index("playback_completion_delivery").on(
			table.outcomeState,
			table.attemptedAt,
			table.id,
		),
		index("playback_completion_source").on(table.sourceId),
	],
);
