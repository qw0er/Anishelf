import { desc } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
/** Provider snapshots are independent of resource roots and anime associations. */
export const metadataSnapshots = sqliteTable(
	"metadata_snapshots",
	{
		id: text("id").primaryKey(),
		key: text("cache_key").notNull(),
		kind: text("kind", {
			enum: ["search", "detail", "relations", "airing"],
		}).notNull(),
		data: text("data", { mode: "json" }).$type<unknown>().notNull(),
		raw: text("raw", { mode: "json" }).$type<unknown>().notNull(),
		fetchedAt: integer("fetched_at").notNull(),
		expiresAt: integer("expires_at").notNull(),
		accessedAt: integer("accessed_at").notNull(),
		failure: text("failure", { mode: "json" }).$type<{
			code:
				| "invalid-request"
				| "not-found"
				| "unavailable"
				| "rate-limited"
				| "invalid-response"
				| "busy"
				| "storage-unavailable";
			message: string;
			retryAt: number | null;
		}>(),
	},
	(table) => [
		index("metadata_cache_key").on(table.key, desc(table.fetchedAt)),
		index("metadata_lru").on(table.kind, table.accessedAt),
	],
);

export const metadataPins = sqliteTable(
	"metadata_pins",
	{
		snapshotId: text("snapshot_id")
			.notNull()
			.references(() => metadataSnapshots.id, { onDelete: "cascade" }),
		ownerId: text("owner_id").notNull(),
	},
	(table) => [
		uniqueIndex("metadata_pin_owner").on(table.snapshotId, table.ownerId),
	],
);

export const metadataArtwork = sqliteTable("metadata_artwork", {
	id: text("id").primaryKey(),
	key: text("asset_key").notNull(),
	url: text("url").notNull(),
	mimeType: text("mime_type").notNull(),
	sizeBytes: integer("size_bytes").notNull(),
	accessedAt: integer("accessed_at").notNull(),
});
