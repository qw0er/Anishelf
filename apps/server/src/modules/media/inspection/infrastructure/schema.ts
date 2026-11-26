import type { MediaInfo } from "@anishelf/media-tools";
import { sql } from "drizzle-orm";
import { check, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const mediaInspections = sqliteTable(
	"media_inspections",
	{
		scopeId: text("scope_id").notNull(),
		fileId: text("file_id").notNull(),
		sourceVersion: text("source_version").notNull(),
		formatVersion: text("format_version").notNull(),
		info: text("info", { mode: "json" }).$type<MediaInfo>().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.scopeId, table.fileId] }),
		check("media_inspection_info", sql`json_valid(${table.info})`),
	],
);
