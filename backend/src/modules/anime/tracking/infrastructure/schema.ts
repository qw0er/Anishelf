import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
	accountId: integer("account_id").primaryKey(),
	fetchedAt: integer("fetched_at").notNull(),
	entries: text("entries", { mode: "json" })
		.$type<import("../domain/list.js").TrackingListEntry[]>()
		.notNull(),
});
