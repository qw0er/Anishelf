import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
	preparationFailureReasons,
	preparationStatuses,
} from "../../../../contracts/schemas/preparation.js";
import { mediaSources } from "../../../resources/persistence.js";

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

export const preparationTasks = sqliteTable(
	"preparation_tasks",
	{
		id: text("id").primaryKey().notNull(),
		sourceId: text("source_id")
			.notNull()
			.references(() => mediaSources.id, { onDelete: "restrict" }),
		executionPlanId: text("execution_plan_id").notNull(),
		profileId: text("profile_id").notNull(),
		profileFingerprint: text("profile_fingerprint").notNull(),
		filename: text("filename").notNull(),
		snapshotVersion: integer("snapshot_version").notNull(),
		snapshotMode: text("snapshot_mode", {
			enum: ["remux", "transcode-audio", "transcode-video", "transcode"],
		}).notNull(),
		snapshotReasonsVideo: text("snapshot_reasons_video").notNull(),
		snapshotReasonsAudio: text("snapshot_reasons_audio").notNull(),
		snapshotVideoStreamIndex: integer("snapshot_video_stream_index").notNull(),
		snapshotPlanContainer: text("snapshot_plan_container").notNull(),
		snapshotPlanDelivery: text("snapshot_plan_delivery", {
			enum: ["file", "media-source"],
		}),
		snapshotPlanOutputFormat: text("snapshot_plan_output_format").notNull(),
		snapshotPlanVideoAction: text("snapshot_plan_video_action", {
			enum: ["copy", "encode"],
		}).notNull(),
		snapshotPlanVideoEncoder: text("snapshot_plan_video_encoder"),
		snapshotPlanVideoCodec: text("snapshot_plan_video_codec"),
		snapshotPlanVideoPixelFormat: text("snapshot_plan_video_pixel_format"),
		snapshotPlanAudioAction: text("snapshot_plan_audio_action", {
			enum: ["copy", "encode"],
		}).notNull(),
		snapshotPlanAudioEncoder: text("snapshot_plan_audio_encoder"),
		snapshotPlanAudioCodec: text("snapshot_plan_audio_codec"),
		snapshotPlanAudioPixelFormat: text("snapshot_plan_audio_pixel_format"),
		snapshotPlanVideoParametersPresent: integer(
			"snapshot_plan_video_parameters_present",
			{ mode: "boolean" },
		).notNull(),
		snapshotPlanVideoParametersPixelFormat: text(
			"snapshot_plan_video_parameters_pixel_format",
		),
		snapshotPlanVideoParametersMaxHeight: integer(
			"snapshot_plan_video_parameters_max_height",
		),
		snapshotPlanVideoParametersEncoder: text(
			"snapshot_plan_video_parameters_encoder",
		),
		snapshotPlanVideoParametersCodec: text(
			"snapshot_plan_video_parameters_codec",
		),
		snapshotPlanVideoParametersCrf: real("snapshot_plan_video_parameters_crf"),
		snapshotPlanVideoParametersPreset: text(
			"snapshot_plan_video_parameters_preset",
		),
		snapshotPlanVideoParametersCpuUsed: integer(
			"snapshot_plan_video_parameters_cpu_used",
		),
		snapshotPlanVideoParametersBitrateKbps: integer(
			"snapshot_plan_video_parameters_bitrate_kbps",
		),
		snapshotPlanAudioParametersPresent: integer(
			"snapshot_plan_audio_parameters_present",
			{ mode: "boolean" },
		).notNull(),
		snapshotPlanAudioParametersChannels: text(
			"snapshot_plan_audio_parameters_channels",
			{ enum: ["preserve", "stereo"] },
		),
		snapshotPlanAudioParametersEncoder: text(
			"snapshot_plan_audio_parameters_encoder",
		),
		snapshotPlanAudioParametersCodec: text(
			"snapshot_plan_audio_parameters_codec",
		),
		snapshotPlanAudioParametersBitrateKbps: integer(
			"snapshot_plan_audio_parameters_bitrate_kbps",
		),
		snapshotPlanAudioParametersCompressionLevel: integer(
			"snapshot_plan_audio_parameters_compression_level",
		),
		snapshotPlanVideoFiltersPresent: integer(
			"snapshot_plan_video_filters_present",
			{ mode: "boolean" },
		).notNull(),
		snapshotPlanH264Level: text("snapshot_plan_h264_level", { enum: ["5.1"] }),
		status: text("status", { enum: preparationStatuses }).notNull(),
		progressPresent: integer("progress_present", { mode: "boolean" }).notNull(),
		progressMediaTimeMs: real("progress_media_time_ms"),
		progressFrames: integer("progress_frames"),
		progressOutputBytes: integer("progress_output_bytes"),
		progressSpeed: real("progress_speed"),
		progressPercent: real("progress_percent"),
		progressEnded: integer("progress_ended", { mode: "boolean" }),
		failureReason: text("failure_reason", { enum: preparationFailureReasons }),
		createdAtMs: integer("created_at_ms").notNull(),
		updatedAtMs: integer("updated_at_ms").notNull(),
	},
	(table) => [
		check("preparation_snapshot_version", sql`${table.snapshotVersion} = 1`),
		check(
			"preparation_progress_shape",
			sql`${table.progressPresent} = 0 OR (${table.progressEnded} IS NOT NULL AND (${table.progressPercent} IS NULL OR ${table.progressPercent} BETWEEN 0 AND 100))`,
		),
		check(
			"preparation_failure_reason",
			sql`${table.failureReason} IN (${sql.raw(preparationFailureReasons.map((reason) => `'${reason}'`).join(", "))})`,
		),
		check(
			"preparation_state_shape",
			sql`(${table.status} IN ('queued', 'processing', 'cancelling', 'ready') AND ${table.failureReason} IS NULL AND (${table.status} <> 'queued' OR ${table.progressPresent} = 0)) OR (${table.status} = 'failed' AND ${table.failureReason} IS NOT NULL) OR (${table.status} = 'cancelled' AND ${table.failureReason} IS NOT NULL AND ${table.failureReason} IN ('cancelled', 'cache-deleted'))`,
		),
		check(
			"preparation_tasks_snapshot_mode_0",
			sql`${table.snapshotMode} IN ('remux', 'transcode-audio', 'transcode-video', 'transcode')`,
		),
		check(
			"preparation_tasks_snapshot_video_stream_index_0",
			sql`${table.snapshotVideoStreamIndex} >= 0`,
		),
		check(
			"preparation_tasks_snapshot_plan_delivery_0",
			sql`${table.snapshotPlanDelivery} IN ('file', 'media-source')`,
		),
		check(
			"preparation_tasks_snapshot_plan_video_action_0",
			sql`${table.snapshotPlanVideoAction} IN ('copy', 'encode')`,
		),
		check(
			"preparation_tasks_snapshot_plan_audio_action_0",
			sql`${table.snapshotPlanAudioAction} IN ('copy', 'encode')`,
		),
		check(
			"preparation_tasks_snapshot_plan_video_parameters_present_0",
			sql`${table.snapshotPlanVideoParametersPresent} IN (0, 1)`,
		),
		check(
			"preparation_tasks_snapshot_plan_audio_parameters_present_0",
			sql`${table.snapshotPlanAudioParametersPresent} IN (0, 1)`,
		),
		check(
			"preparation_tasks_snapshot_plan_audio_parameters_channels_0",
			sql`${table.snapshotPlanAudioParametersChannels} IN ('preserve', 'stereo')`,
		),
		check(
			"preparation_tasks_snapshot_plan_video_filters_present_0",
			sql`${table.snapshotPlanVideoFiltersPresent} IN (0, 1)`,
		),
		check(
			"preparation_tasks_snapshot_plan_h264_level_0",
			sql`${table.snapshotPlanH264Level} IN ('5.1')`,
		),
		check(
			"preparation_tasks_status_0",
			sql`${table.status} IN ('queued', 'processing', 'cancelling', 'ready', 'failed', 'cancelled')`,
		),
		check(
			"preparation_tasks_progress_present_0",
			sql`${table.progressPresent} IN (0, 1)`,
		),
		check(
			"preparation_tasks_progress_ended_0",
			sql`${table.progressEnded} IN (0, 1)`,
		),
		uniqueIndex("preparation_tasks_execution_plan_id_unique").on(
			table.executionPlanId,
		),
		index("preparation_queue").on(table.status, table.updatedAtMs, table.id),
		index("preparation_source").on(table.sourceId),
	],
);
export const preparationTasksSnapshotAudioStreamIndices = sqliteTable(
	"preparation_tasks_snapshot_audio_stream_indices",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => preparationTasks.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: integer("value").notNull(),
	},
	(table) => [
		check(
			"preparation_tasks_snapshot_audio_stream_indices_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		check(
			"preparation_tasks_snapshot_audio_stream_indices_value_0",
			sql`${table.value} >= 0`,
		),
		uniqueIndex("preparation_tasks_snapshot_audio_stream_indices_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const preparationTasksSnapshotPlanFilters = sqliteTable(
	"preparation_tasks_snapshot_plan_filters",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => preparationTasks.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"preparation_tasks_snapshot_plan_filters_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("preparation_tasks_snapshot_plan_filters_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const preparationTasksSnapshotPlanVideoFilters = sqliteTable(
	"preparation_tasks_snapshot_plan_video_filters",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => preparationTasks.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"preparation_tasks_snapshot_plan_video_filters_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("preparation_tasks_snapshot_plan_video_filters_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
