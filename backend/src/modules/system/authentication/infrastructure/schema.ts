import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

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

export const authSessions = sqliteTable(
	"auth_sessions",
	{
		id: text("id").primaryKey().notNull(),
		expiresAt: integer("expires_at").notNull(),
		authFingerprint: text("auth_fingerprint"),
		authExpiresAt: integer("auth_expires_at"),
		csrfToken: text("csrf_token"),
		cookieExpires: text("cookie_expires"),
		cookieOriginalMaxAge: integer("cookie_original_max_age"),
		cookieOriginalExpires: text("cookie_original_expires"),
		cookieSameSite: text("cookie_same_site"),
		cookieSecure: integer("cookie_secure", { mode: "boolean" }),
		cookiePath: text("cookie_path").notNull(),
		cookieHttpOnly: integer("cookie_http_only", { mode: "boolean" }).notNull(),
		cookieDomain: text("cookie_domain"),
		cookiePartitioned: integer("cookie_partitioned", { mode: "boolean" }),
	},
	(table) => [
		check(
			"auth_sessions_cookie_secure_0",
			sql`${table.cookieSecure} IN (0, 1)`,
		),
		check(
			"auth_sessions_cookie_http_only_0",
			sql`${table.cookieHttpOnly} IN (0, 1)`,
		),
		check(
			"auth_sessions_cookie_partitioned_0",
			sql`${table.cookiePartitioned} IN (0, 1)`,
		),
		index("auth_sessions_expiry").on(table.expiresAt),
	],
);
