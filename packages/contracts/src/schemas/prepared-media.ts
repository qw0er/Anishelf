import { Type } from "typebox";
import { errorCodes } from "../errors.ts";
import { NonnegativeIntegerSchema, ResourceIdSchema } from "./common.ts";
import { SourceVersionSchema } from "./playback.ts";

const ArtifactId = Type.String({ pattern: "^[a-f0-9]{64}$" });
const PreparedMediaStatusSchema = Type.Union([
	Type.Literal("ready"),
	Type.Literal("unknown"),
	Type.Literal("unavailable"),
]);
export const PreparedMediaQuerySchema = Type.Object(
	{
		search: Type.Optional(Type.String({ maxLength: 500 })),
		status: Type.Optional(PreparedMediaStatusSchema),
		sort: Type.Optional(
			Type.Union([Type.Literal("newest"), Type.Literal("size")]),
		),
		page: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,5}$" })),
	},
	{ additionalProperties: false },
);
export const PreparedMediaItemSchema = Type.Object(
	{
		id: ArtifactId,
		fileId: ResourceIdSchema,
		sourceVersion: SourceVersionSchema,
		filename: Type.String(),
		sourcePath: Type.String(),
		profileName: Type.String(),
		audioStreamIndices: Type.Array(NonnegativeIntegerSchema),
		sizeBytes: NonnegativeIntegerSchema,
		createdAtMs: NonnegativeIntegerSchema,
		status: PreparedMediaStatusSchema,
		deleteBlockedReason: Type.Union([
			Type.Literal("in-use"),
			Type.Literal("active"),
			Type.Null(),
		]),
	},
	{ additionalProperties: false },
);
export const PreparedMediaListSchema = Type.Object(
	{
		items: Type.Array(PreparedMediaItemSchema),
		total: NonnegativeIntegerSchema,
		page: Type.Integer({ minimum: 1 }),
		pageSize: Type.Literal(50),
		usage: Type.Object(
			{
				count: NonnegativeIntegerSchema,
				copyBytes: NonnegativeIntegerSchema,
				retainedBytes: NonnegativeIntegerSchema,
				availableBytes: NonnegativeIntegerSchema,
			},
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false },
);
export const PreparedMediaDeleteRequestSchema = Type.Object(
	{
		ids: Type.Array(ArtifactId, {
			minItems: 1,
			maxItems: 50,
			uniqueItems: true,
		}),
	},
	{ additionalProperties: false },
);
export const PreparedMediaDeleteResponseSchema = Type.Object(
	{
		results: Type.Array(
			Type.Object(
				{
					id: ArtifactId,
					error: Type.Union([Type.Enum(errorCodes), Type.Null()]),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
