import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { preparedSubtitleFormats } from "../../../../contracts/subtitles.js";
import { mediaSources } from "../../../resources/resource-access/persistence.js";
export const subtitleAssets = sqliteTable(
	"subtitle_assets",
	{
		id: text("id").primaryKey(),
		sourceId: text("source_id")
			.notNull()
			.references(() => mediaSources.id, { onDelete: "restrict" }),
		trackId: text("track_id").notNull(),
		streamIndex: integer("stream_index").notNull(),
		processingVersion: text("processing_version").notNull(),
		format: text("format", { enum: preparedSubtitleFormats }).notNull(),
		status: text("status", { enum: ["pending", "ready", "failed"] }).notNull(),
		sizeBytes: integer("size_bytes"),
		errorCode: text("error_code", {
			enum: [
				"SUBTITLE_EXTRACTION_FAILED",
				"SUBTITLE_TOOL_UNAVAILABLE",
				"SUBTITLE_TOO_LARGE",
				"SUBTITLE_CACHE_FULL",
				"PLAYBACK_CONFLICT",
				"SUBTITLE_INTERRUPTED",
			],
		}),
		updatedAtMs: integer("updated_at_ms").notNull(),
	},
	(table) => [
		uniqueIndex("subtitle_asset_identity").on(
			table.sourceId,
			table.trackId,
			table.format,
			table.processingVersion,
		),
		check("subtitle_stream_index", sql`${table.streamIndex} >= 0`),
		check(
			"subtitle_asset_size",
			sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`,
		),
		check(
			"subtitle_asset_state",
			sql`${table.status} IN ('pending', 'ready', 'failed')`,
		),
	],
);

export const subtitleFontSets = sqliteTable(
	"subtitle_font_sets",
	{
		id: text("id").primaryKey(),
		sourceId: text("source_id")
			.notNull()
			.references(() => mediaSources.id, { onDelete: "restrict" }),
		status: text("status", {
			enum: ["pending", "ready", "degraded"],
		}).notNull(),
		warnings: text("warnings", { mode: "json" }).$type<string[]>().notNull(),
	},
	(table) => [
		index("subtitle_font_source").on(table.sourceId),
		check(
			"subtitle_font_set_status",
			sql`${table.status} IN ('pending', 'ready', 'degraded')`,
		),
	],
);

export const subtitleFontAssets = sqliteTable(
	"subtitle_font_assets",
	{
		id: text("id").primaryKey(),
		setId: text("set_id")
			.notNull()
			.references(() => subtitleFontSets.id, { onDelete: "cascade" }),
		streamIndex: integer("stream_index").notNull(),
		format: text("format", { enum: ["ttf", "otf"] }).notNull(),
		family: text("family").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		digest: text("digest").notNull(),
	},
	(table) => [
		uniqueIndex("subtitle_font_attachment").on(table.setId, table.streamIndex),
		check("subtitle_font_stream", sql`${table.streamIndex} >= 0`),
		check("subtitle_font_size", sql`${table.sizeBytes} > 0`),
		check("subtitle_font_format", sql`${table.format} IN ('ttf', 'otf')`),
	],
);
