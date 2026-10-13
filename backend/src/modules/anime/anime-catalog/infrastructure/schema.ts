import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { mediaSources } from "../../../resources/persistence.js";
import { metadataSnapshots } from "../../metadata/persistence.js";
export const catalogWorks = sqliteTable("catalog_works", {
	id: text("id").primaryKey(),
	title: text("title"),
	aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull(),
	providerTitle: text("provider_title").notNull(),
	searchTitles: text("search_titles", { mode: "json" })
		.$type<string[]>()
		.notNull(),
	format: text("format"),
	year: integer("year"),
	episodeCount: integer("episode_count"),
	revision: integer("revision").notNull(),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

export const catalogProviderLinks = sqliteTable(
	"catalog_provider_links",
	{
		workId: text("work_id")
			.primaryKey()
			.references(() => catalogWorks.id, { onDelete: "restrict" }),
		provider: text("provider").notNull(),
		mediaType: text("media_type", { enum: ["anime"] }).notNull(),
		providerId: text("provider_id").notNull(),
		snapshotId: text("snapshot_id")
			.notNull()
			.references(() => metadataSnapshots.id, { onDelete: "restrict" }),
	},
	(table) => [
		uniqueIndex("catalog_provider_identity").on(
			table.provider,
			table.mediaType,
			table.providerId,
		),
	],
);

export const catalogEpisodes = sqliteTable(
	"catalog_episodes",
	{
		id: text("id").primaryKey(),
		workId: text("work_id")
			.notNull()
			.references(() => catalogWorks.id, { onDelete: "restrict" }),
		kind: text("kind", { enum: ["regular", "special", "movie"] }).notNull(),
		number: text("number").notNull(),
		label: text("label").notNull(),
		provenance: text("provenance", {
			enum: ["confirmed", "count-derived"],
		}).notNull(),
	},
	(table) => [
		uniqueIndex("catalog_episode_identity").on(
			table.workId,
			table.kind,
			table.number,
		),
	],
);

export const catalogAssociations = sqliteTable(
	"catalog_associations",
	{
		sourceId: text("source_id")
			.notNull()
			.references(() => mediaSources.id, { onDelete: "restrict" }),
		episodeId: text("episode_id")
			.notNull()
			.references(() => catalogEpisodes.id, { onDelete: "restrict" }),
		rawNumbers: text("raw_numbers", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		reason: text("reason").notNull(),
		operationKey: text("operation_key").notNull(),
		offset: integer("offset").notNull(),
	},
	(table) => [
		uniqueIndex("catalog_source_episode").on(table.sourceId, table.episodeId),
		index("catalog_episode_sources").on(table.episodeId),
	],
);

export const catalogReviews = sqliteTable("catalog_reviews", {
	id: text("id")
		.primaryKey()
		.references(() => mediaSources.id, { onDelete: "restrict" }),
	result: text("result", { mode: "json" }).$type<unknown>().notNull(),
	available: integer("available", { mode: "boolean" }).notNull(),
	revision: integer("revision").notNull(),
	decision: text("decision", {
		enum: ["pending", "confirmed", "rejected"],
	}).notNull(),
	reason: text("reason"),
});

export const catalogOperations = sqliteTable("catalog_operations", {
	key: text("key").primaryKey(),
	fingerprint: text("fingerprint").notNull(),
	result: text("result", { mode: "json" }).$type<unknown>().notNull(),
});
