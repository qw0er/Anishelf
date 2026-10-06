import { desc, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
	preparationFailureReasons,
	preparationStatuses,
} from "../../contracts/schemas/preparation.js";
import { preparedSubtitleFormats } from "../../contracts/subtitles.js";
import type { MediaExecutionProgress } from "../../shared/media-execution.js";
import type { PreparationSettingsSnapshot } from "../../shared/media-preparation.js";

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

export const preparationTasks = sqliteTable(
	"preparation_tasks",
	{
		id: text("id").primaryKey(),
		sourceId: text("source_id")
			.notNull()
			.references(() => mediaSources.id, { onDelete: "restrict" }),
		executionPlanId: text("execution_plan_id").notNull().unique(),
		profileId: text("profile_id").notNull(),
		profileFingerprint: text("profile_fingerprint").notNull(),
		filename: text("filename").notNull(),
		snapshot: text("snapshot", { mode: "json" })
			.$type<PreparationSettingsSnapshot>()
			.notNull(),
		status: text("status", { enum: preparationStatuses }).notNull(),
		progress: text("progress", {
			mode: "json",
		}).$type<MediaExecutionProgress>(),
		failureReason: text("failure_reason", { enum: preparationFailureReasons }),
		createdAtMs: integer("created_at_ms").notNull(),
		updatedAtMs: integer("updated_at_ms").notNull(),
	},
	(table) => [
		check(
			"preparation_status",
			sql`${table.status} IN ('queued', 'processing', 'cancelling', 'ready', 'failed', 'cancelled')`,
		),
		index("preparation_queue").on(table.status, table.updatedAtMs, table.id),
		index("preparation_source").on(table.sourceId),
	],
);
export const preparedArtifacts = sqliteTable(
	"prepared_artifacts",
	{
		id: text("id").primaryKey(),
		taskId: text("task_id")
			.notNull()
			.unique()
			.references(() => preparationTasks.id, { onDelete: "restrict" }),
		sizeBytes: integer("size_bytes").notNull(),
		mimeType: text("mime_type").notNull(),
	},
	(table) => [check("prepared_size", sql`${table.sizeBytes} > 0`)],
);
