import {
	integer,
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
