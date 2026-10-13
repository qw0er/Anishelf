import { Type } from "typebox";
import { MetadataDetailsResponseSchema } from "./metadata.js";

const id = Type.String({ minLength: 1, maxLength: 200 });
const text = Type.String({ minLength: 1, maxLength: 500 });
const nullableText = Type.Union([Type.String(), Type.Null()]);
const nullableInteger = Type.Union([Type.Integer(), Type.Null()]);
const revision = Type.Integer({ minimum: 1 });
const kind = Type.Union([
	Type.Literal("regular"),
	Type.Literal("special"),
	Type.Literal("movie"),
]);
const decision = Type.Union([
	Type.Literal("pending"),
	Type.Literal("confirmed"),
	Type.Literal("rejected"),
]);
const reference = Type.Object(
	{ provider: id, mediaType: Type.Literal("anime"), id },
	{ additionalProperties: false },
);
const target = Type.Object(
	{
		kind,
		number: Type.String({ minLength: 1, maxLength: 100 }),
		label: Type.Optional(text),
	},
	{ additionalProperties: false },
);
const evidence = Type.Object({
	parser: Type.String(),
	parserVersion: Type.String(),
	normalizationVersion: Type.String(),
	contextFingerprint: Type.String(),
	originalName: Type.String(),
	relativePath: Type.String(),
	inputs: Type.Array(
		Type.Object({
			mode: Type.Union([
				Type.Literal("basename"),
				Type.Literal("ancestor"),
				Type.Literal("path"),
				Type.Literal("together"),
			]),
			input: Type.String(),
			elements: Type.Array(
				Type.Object({
					kind: Type.String(),
					value: Type.String(),
					position: Type.Number(),
				}),
			),
		}),
	),
	titles: Type.Array(Type.String()),
	years: Type.Array(Type.String()),
	seasons: Type.Array(Type.String()),
	parts: Type.Array(Type.String()),
	rawEpisodes: Type.Array(Type.String()),
	numbering: Type.Union([
		Type.Literal("single"),
		Type.Literal("range"),
		Type.Literal("ambiguous"),
		Type.Literal("unknown"),
	]),
	contentKind: Type.Union([
		Type.Literal("regular"),
		Type.Literal("special"),
		Type.Literal("ancillary"),
		Type.Literal("unknown"),
	]),
});
const proposal = Type.Object({
	candidate: Type.Object({
		work: Type.Object({
			reference,
			snapshotId: Type.String(),
			titles: Type.Array(Type.String()),
			year: nullableInteger,
			format: nullableText,
			episodeCount: nullableInteger,
			season: nullableText,
			part: nullableText,
		}),
		score: Type.Number(),
		reasons: Type.Array(Type.String()),
		conflicts: Type.Array(Type.String()),
		matcherVersion: Type.String(),
	}),
	mapping: Type.Object({
		targets: Type.Array(target),
		reasons: Type.Array(Type.String()),
		unresolved: Type.Array(Type.String()),
	}),
});
const review = Type.Object({
	id,
	sourceId: id,
	rootId: id,
	fileId: id,
	relativePath: Type.String(),
	sourceVersion: id,
	available: Type.Boolean(),
	revision,
	decision,
	associations: Type.Array(
		Type.Object({
			workId: id,
			workTitle: Type.String(),
			episodeId: id,
			kind,
			number: Type.String(),
			label: Type.String(),
		}),
	),
	reason: nullableText,
	evidence,
	proposals: Type.Array(proposal),
	metadataStatus: Type.Union([
		Type.Literal("not-configured"),
		Type.Literal("searched"),
		Type.Literal("failed"),
	]),
	unresolved: Type.Array(Type.String()),
});
const work = {
	id,
	title: nullableText,
	aliases: Type.Array(Type.String()),
	providerTitle: Type.String(),
	searchTitles: Type.Array(Type.String()),
	format: nullableText,
	year: nullableInteger,
	episodeCount: nullableInteger,
	revision,
	createdAt: Type.Integer(),
	updatedAt: Type.Integer(),
};
const card = Type.Object({
	...work,
	displayTitle: Type.String(),
	coverUrl: nullableText,
	metadataStale: Type.Boolean(),
	reference,
	availableEpisodes: Type.Integer(),
	availableRegularEpisodes: Type.Integer(),
});
const episode = {
	id,
	workId: id,
	kind,
	number: Type.String(),
	label: Type.String(),
	provenance: Type.Union([
		Type.Literal("confirmed"),
		Type.Literal("count-derived"),
	]),
};
export const CatalogWorkSchema = Type.Object(work);
export const CatalogEpisodeSchema = Type.Object(episode);
export const CatalogReviewSchema = review;
export const CatalogSourceSchema = Type.Object({
	sourceVersion: id,
	associations: review.properties.associations,
});
export const CatalogWorkDetailSchema = Type.Object({
	work: card,
	metadata: MetadataDetailsResponseSchema,
	bannerUrl: nullableText,
	episodes: Type.Array(
		Type.Object({
			...episode,
			availability: Type.Union([
				Type.Literal("available"),
				Type.Literal("unavailable"),
				Type.Literal("missing"),
			]),
			versions: Type.Array(
				Type.Object({
					reviewId: id,
					sourceId: id,
					fileId: id,
					relativePath: Type.String(),
					sourceVersion: id,
					available: Type.Boolean(),
					evidence,
					mapping: Type.Object({
						rawNumbers: Type.Array(Type.String()),
						reason: Type.String(),
						offset: Type.Integer(),
					}),
				}),
			),
		}),
	),
	episodeCountProvenance: Type.Union([
		Type.Literal("provider-count"),
		Type.Literal("unknown"),
	]),
});
const page = <T extends ReturnType<typeof Type.Object>>(item: T) =>
	Type.Object({
		items: Type.Array(item),
		page: Type.Integer(),
		perPage: Type.Integer(),
		hasNextPage: Type.Boolean(),
	});
export const CatalogListSchema = page(card);
export const CatalogReviewListSchema = page(review);
export const CatalogPreviewRequestSchema = Type.Object(
	{
		reference,
		rows: Type.Array(
			Type.Object(
				{
					reviewId: id,
					revision,
					targets: Type.Array(target, { minItems: 1, maxItems: 100 }),
					offset: Type.Optional(
						Type.Integer({ minimum: -10000, maximum: 10000 }),
					),
					reason: text,
				},
				{ additionalProperties: false },
			),
			{ minItems: 1, maxItems: 100 },
		),
	},
	{ additionalProperties: false },
);
export const CatalogPreviewSchema = Type.Object({
	id,
	expiresAt: Type.Integer(),
	reference,
	workId: nullableText,
	workRevision: nullableInteger,
	metadata: MetadataDetailsResponseSchema,
	rows: Type.Array(
		Type.Object({
			reviewId: id,
			revision,
			relativePath: Type.String(),
			rawNumbers: Type.Array(Type.String()),
			before: Type.Array(
				Type.Object({ workId: id, episodeId: id, kind, number: Type.String() }),
			),
			targets: Type.Array(target),
			offset: Type.Integer(),
			reason: Type.String(),
		}),
	),
});
export const CatalogConfirmationRequestSchema = Type.Object(
	{ operationKey: id, previewId: id, replace: Type.Boolean() },
	{ additionalProperties: false },
);
export const CatalogConfirmationSchema = Type.Object({
	workId: id,
	revision,
	reviewIds: Type.Array(id),
});
export const CatalogDecisionRequestSchema = Type.Object(
	{ revision, reason: text },
	{ additionalProperties: false },
);
export const CatalogWorkEditSchema = Type.Object(
	{
		revision,
		title: Type.Union([text, Type.Null()]),
		aliases: Type.Array(text, { maxItems: 100 }),
	},
	{ additionalProperties: false },
);
export const CatalogEpisodeEditSchema = Type.Object(
	{
		revision,
		number: Type.String({ minLength: 1, maxLength: 100 }),
		label: text,
	},
	{ additionalProperties: false },
);
export const CatalogRefreshSchema = Type.Object(
	{ revision },
	{ additionalProperties: false },
);
export const CatalogIdParamsSchema = Type.Object(
	{ id },
	{ additionalProperties: false },
);
export const CatalogEpisodeParamsSchema = Type.Object(
	{ id, episodeId: id },
	{ additionalProperties: false },
);
const pagination = {
	page: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,4}$" })),
	perPage: Type.Optional(Type.String({ pattern: "^[1-9][0-9]?$" })),
};
export const CatalogListQuerySchema = Type.Object(
	{
		...pagination,
		query: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
		format: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
		year: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,3}$" })),
		availability: Type.Optional(
			Type.Union([Type.Literal("available"), Type.Literal("unavailable")]),
		),
		sort: Type.Optional(
			Type.Union([Type.Literal("title"), Type.Literal("recent")]),
		),
	},
	{ additionalProperties: false },
);
export const CatalogReviewQuerySchema = Type.Object(
	{ ...pagination, decision: Type.Optional(decision) },
	{ additionalProperties: false },
);

export const IdentificationStatusSchema = Type.Object({
	running: Type.Boolean(),
	failed: Type.Boolean(),
});
