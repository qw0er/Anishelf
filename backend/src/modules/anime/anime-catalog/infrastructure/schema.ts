import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { mediaSources } from "../../../resources/persistence.js";
import { metadataSnapshots } from "../../metadata/persistence.js";

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
		check("catalog_provider_media_type", sql`${table.mediaType} = 'anime'`),
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
		check(
			"catalog_episode_kind",
			sql`${table.kind} IN ('regular', 'special', 'movie')`,
		),
		check(
			"catalog_episode_provenance",
			sql`${table.provenance} IN ('confirmed', 'count-derived')`,
		),
		uniqueIndex("catalog_episode_identity").on(
			table.workId,
			table.kind,
			table.number,
		),
	],
);

export const catalogWorks = sqliteTable(
	"catalog_works",
	{
		id: text("id").primaryKey().notNull(),
		providerTitle: text("provider_title").notNull(),
		format: text("format"),
		year: integer("year"),
		episodeCount: integer("episode_count"),
		revision: integer("revision").notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		check("catalog_works_episode_count_0", sql`${table.episodeCount} >= 0`),
		check("catalog_works_revision_0", sql`${table.revision} >= 0`),
	],
);
export const catalogWorksSearchTitles = sqliteTable(
	"catalog_works_search_titles",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogWorks.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_works_search_titles_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("catalog_works_search_titles_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogAssociations = sqliteTable(
	"catalog_associations",
	{
		id: text("id").primaryKey().notNull(),
		sourceId: text("source_id")
			.notNull()
			.references(() => mediaSources.id, { onDelete: "restrict" }),
		episodeId: text("episode_id")
			.notNull()
			.references(() => catalogEpisodes.id, { onDelete: "restrict" }),
		reason: text("reason").notNull(),
		operationKey: text("operation_key").notNull(),
		offset: integer("offset").notNull(),
	},
	(table) => [
		uniqueIndex("catalog_source_episode").on(table.sourceId, table.episodeId),
		index("catalog_episode_sources").on(table.episodeId),
	],
);
export const catalogAssociationsRawNumbers = sqliteTable(
	"catalog_associations_raw_numbers",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogAssociations.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_associations_raw_numbers_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("catalog_associations_raw_numbers_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviews = sqliteTable(
	"catalog_reviews",
	{
		id: text("id")
			.primaryKey()
			.notNull()
			.references(() => mediaSources.id, { onDelete: "restrict" }),
		available: integer("available", { mode: "boolean" }).notNull(),
		revision: integer("revision").notNull(),
		decision: text("decision", {
			enum: ["pending", "confirmed", "rejected"],
		}).notNull(),
		reason: text("reason"),
		resultEvidenceParser: text("result_evidence_parser").notNull(),
		resultEvidenceParserVersion: text(
			"result_evidence_parser_version",
		).notNull(),
		resultEvidenceNormalizationVersion: text(
			"result_evidence_normalization_version",
		).notNull(),
		resultEvidenceContextFingerprint: text(
			"result_evidence_context_fingerprint",
		).notNull(),
		resultEvidenceOriginalName: text("result_evidence_original_name").notNull(),
		resultEvidenceRelativePath: text("result_evidence_relative_path").notNull(),
		resultEvidenceTitleSourcesPresent: integer(
			"result_evidence_title_sources_present",
			{ mode: "boolean" },
		).notNull(),
		resultEvidenceSelectedEpisodesPresent: integer(
			"result_evidence_selected_episodes_present",
			{ mode: "boolean" },
		).notNull(),
		resultEvidenceNumbering: text("result_evidence_numbering", {
			enum: ["single", "range", "ambiguous", "unknown"],
		}).notNull(),
		resultEvidenceContentKind: text("result_evidence_content_kind", {
			enum: ["regular", "special", "ancillary", "unknown"],
		}).notNull(),
		resultStatus: text("result_status", {
			enum: ["parsed", "proposed", "unresolved"],
		}).notNull(),
		resultMetadataStatus: text("result_metadata_status", {
			enum: ["not-configured", "searched", "failed"],
		}).notNull(),
	},
	(table) => [
		check("catalog_reviews_available_0", sql`${table.available} IN (0, 1)`),
		check("catalog_reviews_revision_0", sql`${table.revision} >= 0`),
		check(
			"catalog_reviews_decision_0",
			sql`${table.decision} IN ('pending', 'confirmed', 'rejected')`,
		),
		check(
			"catalog_reviews_result_evidence_title_sources_present_0",
			sql`${table.resultEvidenceTitleSourcesPresent} IN (0, 1)`,
		),
		check(
			"catalog_reviews_result_evidence_selected_episodes_present_0",
			sql`${table.resultEvidenceSelectedEpisodesPresent} IN (0, 1)`,
		),
		check(
			"catalog_reviews_result_evidence_numbering_0",
			sql`${table.resultEvidenceNumbering} IN ('single', 'range', 'ambiguous', 'unknown')`,
		),
		check(
			"catalog_reviews_result_evidence_content_kind_0",
			sql`${table.resultEvidenceContentKind} IN ('regular', 'special', 'ancillary', 'unknown')`,
		),
		check(
			"catalog_reviews_result_status_0",
			sql`${table.resultStatus} IN ('parsed', 'proposed', 'unresolved')`,
		),
		check(
			"catalog_reviews_result_metadata_status_0",
			sql`${table.resultMetadataStatus} IN ('not-configured', 'searched', 'failed')`,
		),
		index("catalog_reviews_decision").on(table.decision, table.id),
	],
);
export const catalogReviewsResultEvidenceInputs = sqliteTable(
	"catalog_reviews_result_evidence_inputs",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviews.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		mode: text("mode", {
			enum: ["basename", "ancestor", "path", "together"],
		}).notNull(),
		input: text("input").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_evidence_inputs_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		check(
			"catalog_reviews_result_evidence_inputs_mode_0",
			sql`${table.mode} IN ('basename', 'ancestor', 'path', 'together')`,
		),
		uniqueIndex("catalog_reviews_result_evidence_inputs_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultEvidenceInputsElements = sqliteTable(
	"catalog_reviews_result_evidence_inputs_elements",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviewsResultEvidenceInputs.rowId, {
				onDelete: "cascade",
			}),
		ordinalIndex: integer("ordinal_index").notNull(),
		kind: text("kind").notNull(),
		value: text("value").notNull(),
		position: integer("position").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_evidence_inputs_elements_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		check(
			"catalog_reviews_result_evidence_inputs_elements_position_0",
			sql`${table.position} >= 0`,
		),
		uniqueIndex("catalog_reviews_result_evidence_inputs_elements_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultEvidenceTitles = sqliteTable(
	"catalog_reviews_result_evidence_titles",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviews.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_evidence_titles_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("catalog_reviews_result_evidence_titles_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultEvidenceTitleSources = sqliteTable(
	"catalog_reviews_result_evidence_title_sources",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviews.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		title: text("title").notNull(),
		mode: text("mode", {
			enum: ["basename", "ancestor", "path", "together"],
		}).notNull(),
		distance: integer("distance").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_evidence_title_sources_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		check(
			"catalog_reviews_result_evidence_title_sources_mode_0",
			sql`${table.mode} IN ('basename', 'ancestor', 'path', 'together')`,
		),
		check(
			"catalog_reviews_result_evidence_title_sources_distance_0",
			sql`${table.distance} >= 0`,
		),
		uniqueIndex("catalog_reviews_result_evidence_title_sources_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultEvidenceYears = sqliteTable(
	"catalog_reviews_result_evidence_years",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviews.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_evidence_years_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("catalog_reviews_result_evidence_years_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultEvidenceSeasons = sqliteTable(
	"catalog_reviews_result_evidence_seasons",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviews.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_evidence_seasons_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("catalog_reviews_result_evidence_seasons_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultEvidenceParts = sqliteTable(
	"catalog_reviews_result_evidence_parts",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviews.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_evidence_parts_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("catalog_reviews_result_evidence_parts_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultEvidenceRawEpisodes = sqliteTable(
	"catalog_reviews_result_evidence_raw_episodes",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviews.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_evidence_raw_episodes_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("catalog_reviews_result_evidence_raw_episodes_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultEvidenceSelectedEpisodes = sqliteTable(
	"catalog_reviews_result_evidence_selected_episodes",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviews.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_evidence_selected_episodes_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("catalog_reviews_result_evidence_selected_episodes_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultProposals = sqliteTable(
	"catalog_reviews_result_proposals",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviews.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		candidateWorkReferenceProvider: text(
			"candidate_work_reference_provider",
		).notNull(),
		candidateWorkReferenceMediaType: text(
			"candidate_work_reference_media_type",
			{ enum: ["anime"] },
		).notNull(),
		candidateWorkReferenceId: text("candidate_work_reference_id").notNull(),
		candidateWorkSnapshotId: text("candidate_work_snapshot_id").notNull(),
		candidateWorkTitleVariantsPresent: integer(
			"candidate_work_title_variants_present",
			{ mode: "boolean" },
		).notNull(),
		candidateWorkYear: integer("candidate_work_year"),
		candidateWorkFormat: text("candidate_work_format"),
		candidateWorkEpisodeCount: integer("candidate_work_episode_count"),
		candidateWorkSeason: text("candidate_work_season"),
		candidateWorkPart: text("candidate_work_part"),
		candidateWorkOrdinalSource: text("candidate_work_ordinal_source", {
			enum: ["provider-title"],
		}),
		candidateScore: real("candidate_score").notNull(),
		candidateIdentityConflictsPresent: integer(
			"candidate_identity_conflicts_present",
			{ mode: "boolean" },
		).notNull(),
		candidateIdentityUnresolvedPresent: integer(
			"candidate_identity_unresolved_present",
			{ mode: "boolean" },
		).notNull(),
		candidateAssumptionsPresent: integer("candidate_assumptions_present", {
			mode: "boolean",
		}).notNull(),
		candidateMatcherVersion: text("candidate_matcher_version").notNull(),
		mappingNumberingPresent: integer("mapping_numbering_present", {
			mode: "boolean",
		}).notNull(),
		mappingNumberingSource: text("mapping_numbering_source", {
			enum: ["directory-anchors"],
		}),
		mappingNumberingOffset: integer("mapping_numbering_offset"),
	},
	(table) => [
		check(
			"catalog_reviews_result_proposals_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		check(
			"catalog_reviews_result_proposals_candidate_work_reference_media_type_0",
			sql`${table.candidateWorkReferenceMediaType} IN ('anime')`,
		),
		check(
			"catalog_reviews_result_proposals_candidate_work_title_variants_present_0",
			sql`${table.candidateWorkTitleVariantsPresent} IN (0, 1)`,
		),
		check(
			"catalog_reviews_result_proposals_candidate_work_ordinal_source_0",
			sql`${table.candidateWorkOrdinalSource} IN ('provider-title')`,
		),
		check(
			"catalog_reviews_result_proposals_candidate_identity_conflicts_present_0",
			sql`${table.candidateIdentityConflictsPresent} IN (0, 1)`,
		),
		check(
			"catalog_reviews_result_proposals_candidate_identity_unresolved_present_0",
			sql`${table.candidateIdentityUnresolvedPresent} IN (0, 1)`,
		),
		check(
			"catalog_reviews_result_proposals_candidate_assumptions_present_0",
			sql`${table.candidateAssumptionsPresent} IN (0, 1)`,
		),
		check(
			"catalog_reviews_result_proposals_mapping_numbering_present_0",
			sql`${table.mappingNumberingPresent} IN (0, 1)`,
		),
		check(
			"catalog_reviews_result_proposals_mapping_numbering_source_0",
			sql`${table.mappingNumberingSource} IN ('directory-anchors')`,
		),
		index("catalog_review_candidate_reference").on(
			table.candidateWorkReferenceProvider,
			table.candidateWorkReferenceMediaType,
			table.candidateWorkReferenceId,
			table.parentId,
		),
		uniqueIndex("catalog_reviews_result_proposals_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultProposalsCandidateWorkTitles = sqliteTable(
	"catalog_reviews_result_proposals_candidate_work_titles",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviewsResultProposals.rowId, {
				onDelete: "cascade",
			}),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_proposals_candidate_work_titles_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex(
			"catalog_reviews_result_proposals_candidate_work_titles_order",
		).on(table.parentId, table.ordinalIndex),
	],
);
export const catalogReviewsResultProposalsCandidateWorkTitleVariants =
	sqliteTable(
		"catalog_reviews_result_proposals_candidate_work_title_variants",
		{
			rowId: text("row_id").primaryKey(),
			parentId: text("parent_id")
				.notNull()
				.references(() => catalogReviewsResultProposals.rowId, {
					onDelete: "cascade",
				}),
			ordinalIndex: integer("ordinal_index").notNull(),
			value: text("value").notNull(),
			kind: text("kind", { enum: ["primary", "alias"] }).notNull(),
			language: text("language"),
		},
		(table) => [
			check(
				"catalog_reviews_result_proposals_candidate_work_title_variants_kind_0",
				sql`${table.kind} IN ('primary', 'alias')`,
			),
			uniqueIndex(
				"catalog_reviews_result_proposals_candidate_work_title_variants_order",
			).on(table.parentId, table.ordinalIndex),
		],
	);
export const catalogReviewsResultProposalsCandidateReasons = sqliteTable(
	"catalog_reviews_result_proposals_candidate_reasons",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviewsResultProposals.rowId, {
				onDelete: "cascade",
			}),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_proposals_candidate_reasons_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("catalog_reviews_result_proposals_candidate_reasons_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultProposalsCandidateConflicts = sqliteTable(
	"catalog_reviews_result_proposals_candidate_conflicts",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviewsResultProposals.rowId, {
				onDelete: "cascade",
			}),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_proposals_candidate_conflicts_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex(
			"catalog_reviews_result_proposals_candidate_conflicts_order",
		).on(table.parentId, table.ordinalIndex),
	],
);
export const catalogReviewsResultProposalsCandidateIdentityConflicts =
	sqliteTable(
		"catalog_reviews_result_proposals_candidate_identity_conflicts",
		{
			rowId: text("row_id").primaryKey(),
			parentId: text("parent_id")
				.notNull()
				.references(() => catalogReviewsResultProposals.rowId, {
					onDelete: "cascade",
				}),
			ordinalIndex: integer("ordinal_index").notNull(),
			value: text("value").notNull(),
		},
		(table) => [
			uniqueIndex(
				"catalog_reviews_result_proposals_candidate_identity_conflicts_order",
			).on(table.parentId, table.ordinalIndex),
		],
	);
export const catalogReviewsResultProposalsCandidateIdentityUnresolved =
	sqliteTable(
		"catalog_reviews_result_proposals_candidate_identity_unresolved",
		{
			rowId: text("row_id").primaryKey(),
			parentId: text("parent_id")
				.notNull()
				.references(() => catalogReviewsResultProposals.rowId, {
					onDelete: "cascade",
				}),
			ordinalIndex: integer("ordinal_index").notNull(),
			value: text("value").notNull(),
		},
		(table) => [
			uniqueIndex(
				"catalog_reviews_result_proposals_candidate_identity_unresolved_order",
			).on(table.parentId, table.ordinalIndex),
		],
	);
export const catalogReviewsResultProposalsCandidateAssumptions = sqliteTable(
	"catalog_reviews_result_proposals_candidate_assumptions",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviewsResultProposals.rowId, {
				onDelete: "cascade",
			}),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_proposals_candidate_assumptions_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex(
			"catalog_reviews_result_proposals_candidate_assumptions_order",
		).on(table.parentId, table.ordinalIndex),
	],
);
export const catalogReviewsResultProposalsMappingTargets = sqliteTable(
	"catalog_reviews_result_proposals_mapping_targets",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviewsResultProposals.rowId, {
				onDelete: "cascade",
			}),
		ordinalIndex: integer("ordinal_index").notNull(),
		kind: text("kind", { enum: ["regular", "special", "movie"] }).notNull(),
		number: text("number").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_proposals_mapping_targets_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		check(
			"catalog_reviews_result_proposals_mapping_targets_kind_0",
			sql`${table.kind} IN ('regular', 'special', 'movie')`,
		),
		uniqueIndex("catalog_reviews_result_proposals_mapping_targets_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultProposalsMappingReasons = sqliteTable(
	"catalog_reviews_result_proposals_mapping_reasons",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviewsResultProposals.rowId, {
				onDelete: "cascade",
			}),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_proposals_mapping_reasons_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("catalog_reviews_result_proposals_mapping_reasons_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultProposalsMappingUnresolved = sqliteTable(
	"catalog_reviews_result_proposals_mapping_unresolved",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviewsResultProposals.rowId, {
				onDelete: "cascade",
			}),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_proposals_mapping_unresolved_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("catalog_reviews_result_proposals_mapping_unresolved_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogReviewsResultProposalsMappingNumberingAnchors = sqliteTable(
	"catalog_reviews_result_proposals_mapping_numbering_anchors",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviewsResultProposals.rowId, {
				onDelete: "cascade",
			}),
		ordinalIndex: integer("ordinal_index").notNull(),
		fileId: text("file_id").notNull(),
		sourceVersion: text("source_version").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_proposals_mapping_numbering_anchors_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex(
			"catalog_reviews_result_proposals_mapping_numbering_anchors_order",
		).on(table.parentId, table.ordinalIndex),
	],
);
export const catalogReviewsResultUnresolved = sqliteTable(
	"catalog_reviews_result_unresolved",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogReviews.id, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_reviews_result_unresolved_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("catalog_reviews_result_unresolved_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
export const catalogOperations = sqliteTable(
	"catalog_operations",
	{
		key: text("key").primaryKey().notNull(),
		fingerprint: text("fingerprint").notNull(),
		resultWorkId: text("result_work_id").notNull(),
		resultRevision: integer("result_revision").notNull(),
	},
	(table) => [
		check(
			"catalog_operations_result_revision_0",
			sql`${table.resultRevision} >= 0`,
		),
	],
);
export const catalogOperationsResultReviewIds = sqliteTable(
	"catalog_operations_result_review_ids",
	{
		rowId: text("row_id").primaryKey(),
		parentId: text("parent_id")
			.notNull()
			.references(() => catalogOperations.key, { onDelete: "cascade" }),
		ordinalIndex: integer("ordinal_index").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		check(
			"catalog_operations_result_review_ids_ordinal",
			sql`${table.ordinalIndex} >= 0`,
		),
		uniqueIndex("catalog_operations_result_review_ids_order").on(
			table.parentId,
			table.ordinalIndex,
		),
	],
);
