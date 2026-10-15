import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const authSessions = sqliteTable(
	"auth_sessions",
	{
		id: text("id").primaryKey(),
		data: text("data").notNull(),
		expiresAt: integer("expires_at").notNull(),
	},
	(table) => [index("auth_sessions_expiry").on(table.expiresAt)],
);
export const mediaAccessLinks = sqliteTable(
	"media_access_links",
	{
		tokenHash: text("token_hash").primaryKey(),
		fileId: text("file_id").notNull(),
		sourceVersion: text("source_version").notNull(),
		fingerprint: text("fingerprint").notNull(),
		expiresAt: integer("expires_at").notNull(),
	},
	(table) => [index("media_access_links_expiry").on(table.expiresAt)],
);
