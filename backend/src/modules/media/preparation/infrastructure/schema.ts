import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import {
	preparationFailureReasons,
	preparationStatuses,
} from "../../../../contracts/schemas/preparation.js";
import type { MediaExecutionProgress } from "../../../../platform/media/events.js";
import { mediaSources } from "../../../resources/resource-access/persistence.js";
import type { PreparationSettingsSnapshot } from "../snapshot.js";
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
