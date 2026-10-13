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
