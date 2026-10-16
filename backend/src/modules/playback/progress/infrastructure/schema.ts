import { desc, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { mediaSources } from "../../../resources/persistence.js";
export const playbackCoverage = sqliteTable("playback_coverage", {
	sourceId: text("source_id")
		.primaryKey()
		.references(() => mediaSources.id, { onDelete: "restrict" }),
	durationMs: integer("duration_ms").notNull(),
	intervals: text("intervals", { mode: "json" })
		.$type<[number, number][]>()
		.notNull(),
});
export const playbackCompletions = sqliteTable("playback_completions", {
	id: text("id").primaryKey(),
	sourceId: text("source_id")
		.notNull()
		.references(() => mediaSources.id, { onDelete: "restrict" }),
	context: text("context").notNull(),
	capturedAt: integer("captured_at").notNull(),
	attemptedAt: integer("attempted_at").notNull().default(0),
	outcome: text("outcome", { mode: "json" })
		.$type<import("../domain/completion.js").CompletionOutcome>()
		.notNull(),
	decision: text("decision", { mode: "json" }).$type<
		import("../domain/completion.js").CompletionDecision | null
	>(),
});
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
