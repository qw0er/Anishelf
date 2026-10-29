import { Type } from "typebox";
import { preparationConstraints, rssConstraints } from "../defaults.js";
import { NonnegativeIntegerSchema, ResourceIdSchema } from "./common.js";
import {
	PreparationModeSchema,
	TranscodeProfileIdSchema,
} from "./transcode-profiles.js";

export const ScanWarningSummaryDtoSchema = Type.Object(
	{ count: NonnegativeIntegerSchema, messages: Type.Array(Type.String()) },
	{ additionalProperties: false },
);
export const LibraryIssueDtoSchema = Type.Object(
	{
		code: Type.Union([
			Type.Literal("RESOURCE_ROOT_NOT_CONFIGURED"),
			Type.Literal("RESOURCE_ROOT_UNAVAILABLE"),
			Type.Literal("SCAN_FAILED"),
		]),
		message: Type.String(),
	},
	{ additionalProperties: false },
);
const scanFields = {
	id: Type.String(),
	startedAt: Type.String(),
	visitedCount: NonnegativeIntegerSchema,
	matchedCount: NonnegativeIntegerSchema,
	warnings: ScanWarningSummaryDtoSchema,
};
export const ScanStateDtoSchema = Type.Union([
	Type.Object(
		{ ...scanFields, status: Type.Literal("running"), finishedAt: Type.Null() },
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...scanFields,
			status: Type.Literal("completed"),
			finishedAt: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...scanFields,
			status: Type.Literal("cancelled"),
			finishedAt: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...scanFields,
			status: Type.Literal("failed"),
			finishedAt: Type.String(),
			error: LibraryIssueDtoSchema,
		},
		{ additionalProperties: false },
	),
]);
export const DirectoryDtoSchema = Type.Object(
	{
		kind: Type.Literal("directory"),
		id: ResourceIdSchema,
		parentId: Type.Union([ResourceIdSchema, Type.Null()]),
		name: Type.String(),
	},
	{ additionalProperties: false },
);
export const FileDtoSchema = Type.Object(
	{
		kind: Type.Literal("file"),
		id: ResourceIdSchema,
		parentId: ResourceIdSchema,
		name: Type.String(),
		sizeBytes: Type.Number({ minimum: 0 }),
		modifiedAt: Type.String(),
		mimeType: Type.String(),
		sourceVersion: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);
export const ResourceDtoSchema = Type.Union([
	DirectoryDtoSchema,
	FileDtoSchema,
]);
export const DirectorySearchQuerySchema = Type.Object(
	{ q: Type.String({ minLength: 1, maxLength: 200 }) },
	{ additionalProperties: false },
);
export const DirectorySearchResponseSchema = Type.Object(
	{
		items: Type.Array(
			Type.Object(
				{ resource: ResourceDtoSchema, parentPath: Type.Array(Type.String()) },
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
export const LibraryResponseSchema = Type.Object(
	{
		monitor: Type.Optional(
			Type.Object(
				{
					status: Type.Union([
						Type.Literal("starting"),
						Type.Literal("watching"),
						Type.Literal("degraded"),
						Type.Literal("disabled"),
					]),
					error: Type.Union([Type.String(), Type.Null()]),
				},
				{ additionalProperties: false },
			),
		),
		ready: Type.Boolean(),
		roots: Type.Optional(
			Type.Array(
				Type.Object(
					{
						id: Type.String(),
						name: Type.String(),
						available: Type.Boolean(),
						error: Type.Union([LibraryIssueDtoSchema, Type.Null()]),
					},
					{ additionalProperties: false },
				),
			),
		),
		revision: NonnegativeIntegerSchema,
		scan: Type.Union([ScanStateDtoSchema, Type.Null()]),
		error: Type.Union([LibraryIssueDtoSchema, Type.Null()]),
		stale: Type.Boolean(),
	},
	{ additionalProperties: false },
);
export const ScanResponseSchema = Type.Object(
	{ scan: ScanStateDtoSchema },
	{ additionalProperties: false },
);
export function createSettingsSchemas() {
	const SettingsResponseSchema = Type.Object(
		{
			resourceRoots: Type.Array(Type.String({ minLength: 1 }), {
				maxItems: 64,
				uniqueItems: true,
			}),
			rssRefreshIntervalMinutes: Type.Optional(
				Type.Integer({
					minimum: rssConstraints.minimumRefreshIntervalMinutes,
					maximum: rssConstraints.maximumRefreshIntervalMinutes,
				}),
			),
			transcodeCacheBudgetGiB: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: preparationConstraints.maximumCacheBudgetGiB,
				}),
			),
			defaultTranscodeProfileId: Type.Optional(TranscodeProfileIdSchema),
			defaultAcquisitionProfileId: Type.Optional(
				Type.String({ pattern: "^(builtin|custom):[a-z][a-z0-9-]{0,63}$" }),
			),
			preparationMode: Type.Optional(PreparationModeSchema),
			qbittorrentWebUiUrl: Type.Optional(
				Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
			),
		},
		{ additionalProperties: false },
	);
	const UpdateSettingsRequestSchema = Type.Object(
		{
			resourceRoots: Type.Optional(
				Type.Array(Type.String({ minLength: 1 }), {
					maxItems: 64,
					uniqueItems: true,
				}),
			),
			rssRefreshIntervalMinutes: Type.Optional(
				Type.Integer({
					minimum: rssConstraints.minimumRefreshIntervalMinutes,
					maximum: rssConstraints.maximumRefreshIntervalMinutes,
				}),
			),
			transcodeCacheBudgetGiB: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: preparationConstraints.maximumCacheBudgetGiB,
				}),
			),
			defaultAcquisitionProfileId: Type.Optional(
				Type.String({ pattern: "^(builtin|custom):[a-z][a-z0-9-]{0,63}$" }),
			),
			qbittorrentWebUiUrl: Type.Optional(
				Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
			),
		},
		{ additionalProperties: false, minProperties: 1 },
	);
	return { SettingsResponseSchema, UpdateSettingsRequestSchema };
}
export const { SettingsResponseSchema, UpdateSettingsRequestSchema } =
	createSettingsSchemas();
export const DirectoryResponseSchema = Type.Object(
	{ directory: DirectoryDtoSchema, children: Type.Array(ResourceDtoSchema) },
	{ additionalProperties: false },
);
export const FileResponseSchema = Type.Object(
	{ file: FileDtoSchema, originalMediaUrl: Type.String() },
	{ additionalProperties: false },
);
