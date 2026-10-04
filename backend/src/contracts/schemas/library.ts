import { Type } from "typebox";
import { NonnegativeIntegerSchema, ResourceIdSchema } from "./common.js";
import { TranscodeProfileIdSchema } from "./transcode-profiles.js";

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
	},
	{ additionalProperties: false },
);
export const ResourceDtoSchema = Type.Union([
	DirectoryDtoSchema,
	FileDtoSchema,
]);
export const LibraryResponseSchema = Type.Object(
	{
		ready: Type.Boolean(),
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
export function createSettingsSchemas(maximumScanIntervalMinutes?: number) {
	const interval = Type.Optional(
		Type.Integer({
			minimum: 0,
			...(maximumScanIntervalMinutes === undefined
				? {}
				: { maximum: maximumScanIntervalMinutes }),
		}),
	);
	const SettingsResponseSchema = Type.Object(
		{
			resourceRoot: Type.Union([Type.String(), Type.Null()]),
			scanIntervalMinutes: interval,
			defaultTranscodeProfileId: Type.Optional(TranscodeProfileIdSchema),
		},
		{ additionalProperties: false },
	);
	const UpdateSettingsRequestSchema = Type.Object(
		{
			resourceRoot: Type.String({ minLength: 1 }),
			scanIntervalMinutes: interval,
			defaultTranscodeProfileId: Type.Optional(TranscodeProfileIdSchema),
		},
		{ additionalProperties: false },
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
	{ file: FileDtoSchema, playbackUrl: Type.String() },
	{ additionalProperties: false },
);
