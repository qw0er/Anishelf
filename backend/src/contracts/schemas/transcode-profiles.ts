import { Type } from "typebox";
import { ProfileCatalogIssueSchema } from "./profile-issues.js";
export const TranscodeProfileIdSchema = Type.String({
	pattern: "^(builtin|custom):[a-z][a-z0-9-]{0,63}$",
});
const text = () =>
	Type.String({ minLength: 1, maxLength: 240, pattern: "\\S" });
const token = Type.String({ pattern: "^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$" });
const EncodingOptionsSchema = Type.Record(
	Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]*$" }),
	Type.Union([Type.String({ maxLength: 16384 }), Type.Number(), Type.Null()]),
);
const stream = {
	encoder: token,
	codec: Type.Optional(token),
	options: Type.Optional(EncodingOptionsSchema),
	filters: Type.Optional(
		Type.Array(Type.String({ minLength: 1, maxLength: 16384 }), {
			maxItems: 64,
		}),
	),
};
export const TranscodeVideoSchema = Type.Object(
	{
		...stream,
		pixelFormat: Type.Optional(token),
		maxWidth: Type.Optional(
			Type.Integer({ minimum: 2, maximum: 8192, multipleOf: 2 }),
		),
		maxHeight: Type.Optional(
			Type.Integer({ minimum: 2, maximum: 8192, multipleOf: 2 }),
		),
		maxFrameRate: Type.Optional(
			Type.Number({ exclusiveMinimum: 0, maximum: 1000 }),
		),
	},
	{ additionalProperties: false },
);
export const TranscodeAudioSchema = Type.Object(
	{
		...stream,
		channels: Type.Optional(Type.Integer({ minimum: 1, maximum: 64 })),
		sampleRate: Type.Optional(Type.Integer({ minimum: 1, maximum: 768000 })),
	},
	{ additionalProperties: false },
);
const container = Type.Union([
	Type.Literal("mp4"),
	Type.Literal("webm"),
	Type.Literal("matroska"),
	Type.Literal("mov"),
]);
export const TranscodeProfileSchema = Type.Object(
	{
		id: TranscodeProfileIdSchema,
		name: text(),
		description: text(),
		container,
		globalOptions: Type.Optional(EncodingOptionsSchema),
		inputOptions: Type.Optional(EncodingOptionsSchema),
		muxerOptions: Type.Optional(EncodingOptionsSchema),
		video: TranscodeVideoSchema,
		audio: TranscodeAudioSchema,
	},
	{ additionalProperties: false },
);
export const TranscodeProfilesFileSchema = Type.Object(
	{
		version: Type.Literal(2),
		profiles: Type.Array(TranscodeProfileSchema, { maxItems: 100 }),
	},
	{ additionalProperties: false },
);
const EncodingValidationSchema = Type.Object(
	{
		status: Type.Union([
			Type.Literal("recognized"),
			Type.Literal("unsupported"),
			Type.Literal("unverified"),
		]),
		issues: Type.Array(
			Type.Object(
				{ field: Type.String(), message: Type.String() },
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
export const TranscodeProfileCatalogSchema = Type.Object(
	{
		profiles: Type.Array(
			Type.Object(
				{
					id: TranscodeProfileIdSchema,
					name: text(),
					description: text(),
					container,
					videoCodec: Type.Union([token, Type.Null()]),
					audioCodec: Type.Union([token, Type.Null()]),
					source: Type.Union([Type.Literal("builtin"), Type.Literal("custom")]),
					validation: EncodingValidationSchema,
				},
				{ additionalProperties: false },
			),
		),
		revision: Type.String(),
		selectedProfileId: TranscodeProfileIdSchema,
		selectionAvailable: Type.Boolean(),
		issue: Type.Optional(ProfileCatalogIssueSchema),
	},
	{ additionalProperties: false },
);
export const SelectTranscodeProfileSchema = Type.Object(
	{ profileId: Type.Union([TranscodeProfileIdSchema, Type.Null()]) },
	{ additionalProperties: false },
);
