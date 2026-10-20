import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const trackingConnection = sqliteTable(
	"tracking_connection",
	{
		id: integer("id").primaryKey(),
		generation: text("generation").notNull(),
		accountId: text("account_id"),
		accountName: text("account_name"),
		credentialId: text("credential_id"),
		state: text("state", {
			enum: ["disconnected", "connected", "authorization-required"],
		}).notNull(),
		checkedAt: integer("checked_at"),
	},
	(table) => [
		check("tracking_connection_singleton", sql`${table.id} = 1`),
		check(
			"tracking_connection_state",
			sql`${table.state} IN ('disconnected', 'connected', 'authorization-required')`,
		),
		check(
			"tracking_connection_account",
			sql`(${table.accountId} IS NULL) = (${table.accountName} IS NULL)`,
		),
		check(
			"tracking_connection_credentials",
			sql`${table.state} <> 'connected' OR (${table.accountId} IS NOT NULL AND ${table.credentialId} IS NOT NULL)`,
		),
	],
);

export const trackingIntentVersions = sqliteTable(
	"tracking_intent_versions",
	{
		accountId: text("account_id").notNull(),
		mediaId: text("media_id").notNull(),
		manualVersion: integer("manual_version").notNull().default(0),
	},
	(table) => [
		primaryKey({ columns: [table.accountId, table.mediaId] }),
		check("tracking_manual_version", sql`${table.manualVersion} >= 0`),
	],
);
/** Durable command deduplication is separate from the mutable per-title operation. */
export const trackingCommands = sqliteTable(
	"tracking_commands",
	{
		accountId: text("account_id").notNull(),
		commandId: text("command_id").notNull(),
		operationId: text("operation_id").notNull(),
		revision: integer("revision").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.accountId, table.commandId] }),
		check("tracking_command_revision", sql`${table.revision} >= 0`),
	],
);

export const trackingOperations = sqliteTable(
	"tracking_operations",
	{
		origin: text("origin", {
			enum: ["manual-detail", "manual-player", "automatic"],
		}).notNull(),
		commandId: text("command_id").notNull(),
		intentAt: integer("intent_at").notNull(),
		targetPresent: integer("target_present", { mode: "boolean" }).notNull(),
		targetFileId: text("target_file_id"),
		targetSourceVersion: text("target_source_version"),
		targetReviewId: text("target_review_id"),
		targetMappingRevision: integer("target_mapping_revision"),
		targetEpisodeId: text("target_episode_id"),
		targetMediaId: text("target_media_id"),
		targetEpisode: integer("target_episode"),
		decisionReason: text("decision_reason", {
			enum: ["skipped-episodes", "initial-status-required"],
		}),
		id: text("id").primaryKey().notNull(),
		accountId: text("account_id").notNull(),
		mediaId: text("media_id").notNull(),
		revision: integer("revision").notNull(),
		baselinePresent: integer("baseline_present", { mode: "boolean" }).notNull(),
		baselineId: text("baseline_id"),
		baselineProgress: integer("baseline_progress"),
		baselineStatus: text("baseline_status", {
			enum: [
				"watching",
				"planned",
				"completed",
				"paused",
				"dropped",
				"rewatching",
			],
		}),
		baselineUpdatedAt: integer("baseline_updated_at"),
		desiredProgress: integer("desired_progress"),
		desiredStatus: text("desired_status", {
			enum: [
				"watching",
				"planned",
				"completed",
				"paused",
				"dropped",
				"rewatching",
			],
		}),
		state: text("state", {
			enum: [
				"decision-required",
				"pending",
				"submitting",
				"failed",
				"conflict",
				"authorization-required",
				"succeeded",
				"cancelled",
			],
		}).notNull(),
		remotePresent: integer("remote_present", { mode: "boolean" }).notNull(),
		remoteId: text("remote_id"),
		remoteProgress: integer("remote_progress"),
		remoteStatus: text("remote_status", {
			enum: [
				"watching",
				"planned",
				"completed",
				"paused",
				"dropped",
				"rewatching",
			],
		}),
		remoteUpdatedAt: integer("remote_updated_at"),
		attemptPresent: integer("attempt_present", { mode: "boolean" }).notNull(),
		attemptRevision: integer("attempt_revision"),
		attemptBaselinePresent: integer("attempt_baseline_present", {
			mode: "boolean",
		}).notNull(),
		attemptBaselineId: text("attempt_baseline_id"),
		attemptBaselineProgress: integer("attempt_baseline_progress"),
		attemptBaselineStatus: text("attempt_baseline_status", {
			enum: [
				"watching",
				"planned",
				"completed",
				"paused",
				"dropped",
				"rewatching",
			],
		}),
		attemptBaselineUpdatedAt: integer("attempt_baseline_updated_at"),
		attemptDesiredProgress: integer("attempt_desired_progress"),
		attemptDesiredStatus: text("attempt_desired_status", {
			enum: [
				"watching",
				"planned",
				"completed",
				"paused",
				"dropped",
				"rewatching",
			],
		}),
		attempts: integer("attempts").notNull(),
		retryAt: integer("retry_at"),
		error: text("error"),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		check(
			"tracking_operations_origin_0",
			sql`${table.origin} IN ('manual-detail', 'manual-player', 'automatic')`,
		),
		check(
			"tracking_operations_target_present_0",
			sql`${table.targetPresent} IN (0, 1)`,
		),
		check(
			"tracking_operations_target_mapping_revision_0",
			sql`${table.targetMappingRevision} >= 0`,
		),
		check(
			"tracking_operations_target_episode_0",
			sql`${table.targetEpisode} >= 1`,
		),
		check(
			"tracking_operations_decision_reason_0",
			sql`${table.decisionReason} IN ('skipped-episodes', 'initial-status-required')`,
		),
		check("tracking_operations_revision_0", sql`${table.revision} >= 0`),
		check(
			"tracking_operations_baseline_present_0",
			sql`${table.baselinePresent} IN (0, 1)`,
		),
		check(
			"tracking_operations_baseline_progress_0",
			sql`${table.baselineProgress} >= 0`,
		),
		check(
			"tracking_operations_baseline_status_0",
			sql`${table.baselineStatus} IN ('watching', 'planned', 'completed', 'paused', 'dropped', 'rewatching')`,
		),
		check(
			"tracking_operations_desired_progress_0",
			sql`${table.desiredProgress} >= 0`,
		),
		check(
			"tracking_operations_desired_status_0",
			sql`${table.desiredStatus} IN ('watching', 'planned', 'completed', 'paused', 'dropped', 'rewatching')`,
		),
		check(
			"tracking_operations_state_0",
			sql`${table.state} IN ('decision-required', 'pending', 'submitting', 'failed', 'conflict', 'authorization-required', 'succeeded', 'cancelled')`,
		),
		check(
			"tracking_operations_remote_present_0",
			sql`${table.remotePresent} IN (0, 1)`,
		),
		check(
			"tracking_operations_remote_progress_0",
			sql`${table.remoteProgress} >= 0`,
		),
		check(
			"tracking_operations_remote_status_0",
			sql`${table.remoteStatus} IN ('watching', 'planned', 'completed', 'paused', 'dropped', 'rewatching')`,
		),
		check(
			"tracking_operations_attempt_present_0",
			sql`${table.attemptPresent} IN (0, 1)`,
		),
		check(
			"tracking_operations_attempt_revision_0",
			sql`${table.attemptRevision} >= 0`,
		),
		check(
			"tracking_operations_attempt_baseline_present_0",
			sql`${table.attemptBaselinePresent} IN (0, 1)`,
		),
		check(
			"tracking_operations_attempt_baseline_progress_0",
			sql`${table.attemptBaselineProgress} >= 0`,
		),
		check(
			"tracking_operations_attempt_baseline_status_0",
			sql`${table.attemptBaselineStatus} IN ('watching', 'planned', 'completed', 'paused', 'dropped', 'rewatching')`,
		),
		check(
			"tracking_operations_attempt_desired_progress_0",
			sql`${table.attemptDesiredProgress} >= 0`,
		),
		check(
			"tracking_operations_attempt_desired_status_0",
			sql`${table.attemptDesiredStatus} IN ('watching', 'planned', 'completed', 'paused', 'dropped', 'rewatching')`,
		),
		check("tracking_operations_attempts_0", sql`${table.attempts} >= 0`),
		uniqueIndex("tracking_operations_account_media").on(
			table.accountId,
			table.mediaId,
		),
		index("tracking_operations_due").on(
			table.accountId,
			table.state,
			table.retryAt,
		),
	],
);
export const trackingListCache = sqliteTable(
	"tracking_list_cache",
	{
		invalidated: integer("invalidated", { mode: "boolean" }),
		accountId: text("account_id").primaryKey().notNull(),
		fetchedAt: integer("fetched_at").notNull(),
	},
	(table) => [
		check(
			"tracking_list_cache_invalidated_0",
			sql`${table.invalidated} IN (0, 1)`,
		),
	],
);
export const trackingListCacheEntries = sqliteTable(
	"tracking_list_cache_entries",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => trackingListCache.accountId, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		id: text("id").notNull(),
		mediaId: text("media_id").notNull(),
		progress: integer("progress").notNull(),
		status: text("status", {
			enum: [
				"watching",
				"planned",
				"completed",
				"paused",
				"dropped",
				"rewatching",
			],
		}).notNull(),
		updatedAt: integer("updated_at"),
		format: text("format"),
		year: integer("year"),
		episodeCount: integer("episode_count"),
		coverUrl: text("cover_url"),
	},
	(table) => [
		check(
			"tracking_list_cache_entries_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		check(
			"tracking_list_cache_entries_progress_0",
			sql`${table.progress} >= 0`,
		),
		check(
			"tracking_list_cache_entries_status_0",
			sql`${table.status} IN ('watching', 'planned', 'completed', 'paused', 'dropped', 'rewatching')`,
		),
		uniqueIndex("tracking_list_entry_media").on(table.parentId, table.mediaId),
		uniqueIndex("tracking_list_cache_entries_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const trackingListCacheEntriesTitles = sqliteTable(
	"tracking_list_cache_entries_titles",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => trackingListCacheEntries.rowId, {
				onDelete: "cascade",
			}),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"tracking_list_cache_entries_titles_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("tracking_list_cache_entries_titles_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
