import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

export const metadataPins = sqliteTable(
	"metadata_pins",
	{
		snapshotId: text("snapshot_id")
			.notNull()
			.references(() => metadataSnapshots.id, { onDelete: "cascade" }),
		ownerId: text("owner_id").notNull(),
	},
	(table) => [primaryKey({ columns: [table.snapshotId, table.ownerId] })],
);

export const metadataArtwork = sqliteTable(
	"metadata_artwork",
	{
		id: text("id").primaryKey(),
		key: text("asset_key").notNull(),
		url: text("url").notNull(),
		mimeType: text("mime_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		accessedAt: integer("accessed_at").notNull(),
	},
	(table) => [
		check("metadata_artwork_size", sql`${table.sizeBytes} >= 0`),
		index("metadata_artwork_lru").on(table.accessedAt),
	],
);

export const metadataSnapshots = sqliteTable(
	"metadata_snapshots",
	{
		id: text("id").primaryKey().notNull(),
		key: text("key").notNull(),
		kind: text("kind", {
			enum: ["search", "detail", "relations", "airing"],
		}).notNull(),
		fetchedAt: integer("fetched_at").notNull(),
		expiresAt: integer("expires_at").notNull(),
		accessedAt: integer("accessed_at").notNull(),
		failurePresent: integer("failure_present", { mode: "boolean" }).notNull(),
		failureCode:
			text("failure_code").$type<
				import("../domain/model.js").MetadataFailure["code"]
			>(),
		failureMessage: text("failure_message"),
		failureRetryAt: integer("failure_retry_at"),
		data: text("data", { mode: "json" }).$type<unknown>().notNull(),
	},
	(table) => [
		check(
			"metadata_snapshot_failure",
			sql`${table.failurePresent} = 0 OR (${table.failureCode} IS NOT NULL AND ${table.failureMessage} IS NOT NULL)`,
		),
		check(
			"metadata_snapshots_kind_0",
			sql`${table.kind} IN ('search', 'detail', 'relations', 'airing')`,
		),
		check(
			"metadata_snapshots_failure_present_0",
			sql`${table.failurePresent} IN (0,1)`,
		),
		check("metadata_snapshot_data", sql`json_valid(${table.data})`),
		index("metadata_cache_key").on(table.key, table.fetchedAt),
		index("metadata_lru").on(table.kind, table.accessedAt),
	],
);
