import { desc, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const resourceRoots = sqliteTable("resource_roots", {
	id: text("id").primaryKey(),
	canonicalPath: text("canonical_path").notNull().unique(),
	createdAtMs: integer("created_at_ms").notNull(),
});

export const mediaSources = sqliteTable(
	"media_sources",
	{
		id: text("id").primaryKey(),
		rootId: text("root_id")
			.notNull()
			.references(() => resourceRoots.id, { onDelete: "restrict" }),
		fileId: text("file_id").notNull(),
		relativePath: text("relative_path").notNull(),
		sourceVersion: text("source_version").notNull(),
		createdAtMs: integer("created_at_ms").notNull(),
	},
	(table) => [
		uniqueIndex("media_sources_identity").on(
			table.rootId,
			table.fileId,
			table.sourceVersion,
		),
		index("media_sources_root").on(table.rootId, table.id),
	],
);

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
