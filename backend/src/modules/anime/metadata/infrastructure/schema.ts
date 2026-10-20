import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
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
		failureCode: text("failure_code"),
		failureMessage: text("failure_message"),
		failureRetryAt: integer("failure_retry_at"),
		page: integer("page"),
		perPage: integer("per_page"),
		hasNextPage: integer("has_next_page", { mode: "boolean" }),
		detailPresent: integer("detail_present", { mode: "boolean" }).notNull(),
		detailReferenceProvider: text("detail_reference_provider"),
		detailReferenceMediaType: text("detail_reference_media_type", {
			enum: ["anime"],
		}),
		detailReferenceId: text("detail_reference_id"),
		detailYear: integer("detail_year"),
		detailFormat: text("detail_format"),
		detailStatus: text("detail_status"),
		detailEpisodeCount: integer("detail_episode_count"),
		detailAiringSeason: text("detail_airing_season"),
		detailCoverUrl: text("detail_cover_url"),
		detailDescription: text("detail_description"),
		detailBannerUrl: text("detail_banner_url"),
		detailStartDatePresent: integer("detail_start_date_present", {
			mode: "boolean",
		}).notNull(),
		detailStartDateYear: integer("detail_start_date_year"),
		detailStartDateMonth: integer("detail_start_date_month"),
		detailStartDateDay: integer("detail_start_date_day"),
		detailEndDatePresent: integer("detail_end_date_present", {
			mode: "boolean",
		}).notNull(),
		detailEndDateYear: integer("detail_end_date_year"),
		detailEndDateMonth: integer("detail_end_date_month"),
		detailEndDateDay: integer("detail_end_date_day"),
		detailDurationMinutes: integer("detail_duration_minutes"),
		detailCountry: text("detail_country"),
		detailSource: text("detail_source"),
		detailAverageScore: integer("detail_average_score"),
		detailSiteUrl: text("detail_site_url"),
		detailProviderUpdatedAt: integer("detail_provider_updated_at"),
		detailEpisodeCatalog: text("detail_episode_catalog", {
			enum: ["unavailable"],
		}),
	},
	(table) => [
		check(
			"metadata_snapshot_projection",
			sql`(${table.kind} = 'detail' AND ${table.detailPresent} = 1) OR (${table.kind} <> 'detail' AND ${table.detailPresent} = 0 AND ${table.page} IS NOT NULL AND ${table.perPage} IS NOT NULL AND ${table.hasNextPage} IS NOT NULL)`,
		),
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
			sql`${table.failurePresent} IN (0, 1)`,
		),
		check(
			"metadata_snapshots_has_next_page_0",
			sql`${table.hasNextPage} IN (0, 1)`,
		),
		check(
			"metadata_snapshots_detail_present_0",
			sql`${table.detailPresent} IN (0, 1)`,
		),
		check(
			"metadata_snapshots_detail_reference_media_type_0",
			sql`${table.detailReferenceMediaType} IN ('anime')`,
		),
		check(
			"metadata_snapshots_detail_episode_count_0",
			sql`${table.detailEpisodeCount} >= 0`,
		),
		check(
			"metadata_snapshots_detail_start_date_present_0",
			sql`${table.detailStartDatePresent} IN (0, 1)`,
		),
		check(
			"metadata_snapshots_detail_end_date_present_0",
			sql`${table.detailEndDatePresent} IN (0, 1)`,
		),
		check(
			"metadata_snapshots_detail_episode_catalog_0",
			sql`${table.detailEpisodeCatalog} IN ('unavailable')`,
		),
		index("metadata_cache_key").on(table.key, table.fetchedAt),
		index("metadata_lru").on(table.kind, table.accessedAt),
	],
);
export const metadataSnapshotsDetailUnavailableFields = sqliteTable(
	"metadata_snapshots_detail_unavailable_fields",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => metadataSnapshots.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"metadata_snapshots_detail_unavailable_fields_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("metadata_snapshots_detail_unavailable_fields_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const metadataSnapshotsDetailTitles = sqliteTable(
	"metadata_snapshots_detail_titles",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => metadataSnapshots.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
		language: text("language"),
		kind: text("kind", {
			enum: ["romaji", "english", "native", "alias"],
		}).notNull(),
	},
	(table) => [
		check(
			"metadata_snapshots_detail_titles_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		check(
			"metadata_snapshots_detail_titles_kind_0",
			sql`${table.kind} IN ('romaji', 'english', 'native', 'alias')`,
		),
		uniqueIndex("metadata_snapshots_detail_titles_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const metadataSnapshotsDetailGenres = sqliteTable(
	"metadata_snapshots_detail_genres",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => metadataSnapshots.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"metadata_snapshots_detail_genres_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("metadata_snapshots_detail_genres_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const metadataSnapshotsDetailTags = sqliteTable(
	"metadata_snapshots_detail_tags",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => metadataSnapshots.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		name: text("name").notNull(),
		rank: integer("rank"),
		spoiler: integer("spoiler", { mode: "boolean" }).notNull(),
	},
	(table) => [
		check(
			"metadata_snapshots_detail_tags_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		check(
			"metadata_snapshots_detail_tags_spoiler_0",
			sql`${table.spoiler} IN (0, 1)`,
		),
		uniqueIndex("metadata_snapshots_detail_tags_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const metadataSnapshotsDetailStudios = sqliteTable(
	"metadata_snapshots_detail_studios",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => metadataSnapshots.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		id: text("id").notNull(),
		name: text("name").notNull(),
	},
	(table) => [
		check(
			"metadata_snapshots_detail_studios_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("metadata_snapshots_detail_studios_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const metadataSnapshotsDetailStreamingEpisodes = sqliteTable(
	"metadata_snapshots_detail_streaming_episodes",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => metadataSnapshots.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		title: text("title"),
		url: text("url"),
		site: text("site"),
		thumbnail: text("thumbnail"),
	},
	(table) => [
		check(
			"metadata_snapshots_detail_streaming_episodes_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("metadata_snapshots_detail_streaming_episodes_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const metadataSnapshotsItems = sqliteTable(
	"metadata_snapshots_items",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => metadataSnapshots.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		referenceProvider: text("reference_provider").notNull(),
		referenceMediaType: text("reference_media_type", {
			enum: ["anime"],
		}).notNull(),
		referenceId: text("reference_id").notNull(),
		year: integer("year"),
		format: text("format"),
		status: text("status"),
		episodeCount: integer("episode_count"),
		airingSeason: text("airing_season"),
		coverUrl: text("cover_url"),
	},
	(table) => [
		check("metadata_snapshots_items_ordinal", sql`${table.ordinalIndex} >= 0`),
		check(
			"metadata_snapshots_items_reference_media_type_0",
			sql`${table.referenceMediaType} IN ('anime')`,
		),
		check(
			"metadata_snapshots_items_episode_count_0",
			sql`${table.episodeCount} >= 0`,
		),
		uniqueIndex("metadata_snapshots_items_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const metadataSnapshotsItemsUnavailableFields = sqliteTable(
	"metadata_snapshots_items_unavailable_fields",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => metadataSnapshotsItems.rowId, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"metadata_snapshots_items_unavailable_fields_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("metadata_snapshots_items_unavailable_fields_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const metadataSnapshotsItemsTitles = sqliteTable(
	"metadata_snapshots_items_titles",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => metadataSnapshotsItems.rowId, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
		language: text("language"),
		kind: text("kind", {
			enum: ["romaji", "english", "native", "alias"],
		}).notNull(),
	},
	(table) => [
		check(
			"metadata_snapshots_items_titles_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		check(
			"metadata_snapshots_items_titles_kind_0",
			sql`${table.kind} IN ('romaji', 'english', 'native', 'alias')`,
		),
		uniqueIndex("metadata_snapshots_items_titles_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const metadataSnapshotsRelations = sqliteTable(
	"metadata_snapshots_relations",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => metadataSnapshots.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		type: text("type").notNull(),
		workReferenceProvider: text("work_reference_provider").notNull(),
		workReferenceMediaType: text("work_reference_media_type", {
			enum: ["anime"],
		}).notNull(),
		workReferenceId: text("work_reference_id").notNull(),
		workYear: integer("work_year"),
		workFormat: text("work_format"),
		workStatus: text("work_status"),
		workEpisodeCount: integer("work_episode_count"),
		workAiringSeason: text("work_airing_season"),
		workCoverUrl: text("work_cover_url"),
	},
	(table) => [
		check(
			"metadata_snapshots_relations_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		check(
			"metadata_snapshots_relations_work_reference_media_type_0",
			sql`${table.workReferenceMediaType} IN ('anime')`,
		),
		check(
			"metadata_snapshots_relations_work_episode_count_0",
			sql`${table.workEpisodeCount} >= 0`,
		),
		uniqueIndex("metadata_snapshots_relations_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const metadataSnapshotsRelationsWorkUnavailableFields = sqliteTable(
	"metadata_snapshots_relations_work_unavailable_fields",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => metadataSnapshotsRelations.rowId, {
				onDelete: "cascade",
			}),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"metadata_snapshots_relations_work_unavailable_fields_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex(
			"metadata_snapshots_relations_work_unavailable_fields_order",
		).on(table.parentId, table.ordinalIndex),
	],
);
export const metadataSnapshotsRelationsWorkTitles = sqliteTable(
	"metadata_snapshots_relations_work_titles",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => metadataSnapshotsRelations.rowId, {
				onDelete: "cascade",
			}),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
		language: text("language"),
		kind: text("kind", {
			enum: ["romaji", "english", "native", "alias"],
		}).notNull(),
	},
	(table) => [
		check(
			"metadata_snapshots_relations_work_titles_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		check(
			"metadata_snapshots_relations_work_titles_kind_0",
			sql`${table.kind} IN ('romaji', 'english', 'native', 'alias')`,
		),
		uniqueIndex("metadata_snapshots_relations_work_titles_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const metadataSnapshotsAiring = sqliteTable(
	"metadata_snapshots_airing",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => metadataSnapshots.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		id: text("id").notNull(),
		episode: integer("episode").notNull(),
		airingAt: integer("airing_at").notNull(),
	},
	(table) => [
		check("metadata_snapshots_airing_ordinal", sql`${table.ordinalIndex} >= 0`),
		uniqueIndex("metadata_snapshots_airing_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
