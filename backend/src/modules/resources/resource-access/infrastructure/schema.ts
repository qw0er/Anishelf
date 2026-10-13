import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const resourceRoots = sqliteTable("resource_roots", {
	id: text("id").primaryKey(),
	canonicalPath: text("canonical_path").notNull().unique(),
	createdAtMs: integer("created_at_ms").notNull(),
});

export const mediaSources = sqliteTable(
	"media_sources",
	{
		id: text("id").primaryKey(),
		rootId: text("root_id")
			.notNull()
			.references(() => resourceRoots.id, { onDelete: "restrict" }),
		fileId: text("file_id").notNull(),
		relativePath: text("relative_path").notNull(),
		sourceVersion: text("source_version").notNull(),
		createdAtMs: integer("created_at_ms").notNull(),
	},
	(table) => [
		uniqueIndex("media_sources_identity").on(
			table.rootId,
			table.fileId,
			table.sourceVersion,
		),
		index("media_sources_root").on(table.rootId, table.id),
	],
);
