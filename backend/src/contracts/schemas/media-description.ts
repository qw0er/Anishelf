import { Type } from "typebox";

const nullableNumber = Type.Union([Type.Number({ minimum: 0 }), Type.Null()]);
const nullableString = Type.Union([
	Type.String({ maxLength: 256 }),
	Type.Null(),
]);
export const AudioStreamSelectionSchema = Type.Array(
	Type.Integer({ minimum: 0 }),
	{ maxItems: 128, uniqueItems: true },
);
const streamIdentity = {
	index: Type.Integer({ minimum: 0 }),
	codec: nullableString,
	codecString: nullableString,
	profile: nullableString,
	bitrate: nullableNumber,
	language: Type.Optional(nullableString),
	label: Type.Optional(nullableString),
	default: Type.Optional(Type.Boolean()),
};
export const VideoStreamDescriptionSchema = Type.Object(
	{
		...streamIdentity,
		kind: Type.Literal("video"),
		pixelFormat: nullableString,
		bitDepth: nullableNumber,
		hdr: Type.Union([Type.Boolean(), Type.Null()]),
		width: nullableNumber,
		height: nullableNumber,
		frameRate: nullableNumber,
	},
	{ additionalProperties: false },
);
export const AudioStreamDescriptionSchema = Type.Object(
	{
		...streamIdentity,
		kind: Type.Literal("audio"),
		sampleRate: nullableNumber,
		channels: nullableNumber,
	},
	{ additionalProperties: false },
);
