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
