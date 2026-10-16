import {
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const trackingOperations = sqliteTable(
	"tracking_operations",
	{
		id: text("id").primaryKey(),
		accountId: integer("account_id").notNull(),
		mediaId: integer("media_id").notNull(),
		operation: text("operation", { mode: "json" })
			.$type<import("../domain/operation.js").TrackingOperation>()
			.notNull(),
	},
	(table) => [
		uniqueIndex("tracking_operations_account_media").on(
			table.accountId,
			table.mediaId,
		),
	],
);
export const trackingConnection = sqliteTable("tracking_connection", {
	id: integer("id").primaryKey(),
	generation: text("generation").notNull(),
	accountId: integer("account_id"),
	accountName: text("account_name"),
	credentialId: text("credential_id"),
	state: text("state", {
		enum: ["disconnected", "connected", "authorization-required"],
	}).notNull(),
	checkedAt: integer("checked_at"),
});

export const trackingListCache = sqliteTable("tracking_list_cache", {
	invalidated: integer("invalidated", { mode: "boolean" })
		.notNull()
		.default(false),
	accountId: integer("account_id").primaryKey(),
	fetchedAt: integer("fetched_at").notNull(),
	entries: text("entries", { mode: "json" })
		.$type<import("../domain/list.js").TrackingListEntry[]>()
		.notNull(),
});

/** Intent ordering survives operation pruning and worker state changes. */
export const trackingIntentVersions = sqliteTable(
	"tracking_intent_versions",
	{
		accountId: integer("account_id").notNull(),
		mediaId: integer("media_id").notNull(),
		manualVersion: integer("manual_version").notNull().default(0),
	},
	(table) => [primaryKey({ columns: [table.accountId, table.mediaId] })],
);
/** Durable command deduplication is separate from the mutable per-title operation. */
export const trackingCommands = sqliteTable(
	"tracking_commands",
	{
		accountId: integer("account_id").notNull(),
		commandId: text("command_id").notNull(),
		operationId: text("operation_id").notNull(),
		revision: integer("revision").notNull(),
	},
	(table) => [primaryKey({ columns: [table.accountId, table.commandId] })],
);
