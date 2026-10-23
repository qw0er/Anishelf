import { type Static, Type } from "typebox";
import { fingerprint } from "../../../../shared/fingerprint.js";
import type { DeepReadonly } from "../../../../shared/policy.js";

const list = <T extends Parameters<typeof Type.Array>[0]>(schema: T) =>
	Type.Optional(
		Type.Array(schema, { minItems: 1, maxItems: 64, uniqueItems: true }),
	);
const word = Type.String({ minLength: 1, maxLength: 240, pattern: "\\S" });
const enumeration = <const T extends string[]>(values: T) => Type.Enum(values);
const AcquisitionProfileIdSchema = Type.String({
	pattern: "^(builtin|custom):[a-z][a-z0-9-]{0,63}$",
});
const ReleaseConditionsSchema = Type.Object(
	{
		subtitleLanguages: list(
			enumeration(["zh-Hans", "zh-Hant", "en", "ja", "ko"]),
		),
		subtitleFormats: list(enumeration(["hard", "soft", "external"])),
		resolutions: list(Type.Integer({ minimum: 1, maximum: 8640 })),
		videoCodecs: list(
			enumeration(["avc", "hevc", "av1", "vp9", "mpeg2", "mpeg4"]),
		),
		sources: list(enumeration(["web", "bluray", "hdtv", "dvd"])),
		releaseGroups: list(word),
		excludeReleaseGroups: list(word),
		includeKeywords: list(word),
		excludeKeywords: list(word),
		minSeeders: Type.Optional(
			Type.Integer({ minimum: 0, maximum: 2147483647 }),
		),
		unknownSeeders: Type.Optional(enumeration(["allow", "reject"])),
	},
	{ additionalProperties: false },
);
const AcquisitionProfileSchema = Type.Object(
	{
		id: AcquisitionProfileIdSchema,
		name: word,
		description: Type.Optional(word),
		requirements: Type.Optional(ReleaseConditionsSchema),
		preferMoreSeeders: Type.Optional(Type.Boolean()),
		levels: Type.Array(
			Type.Object(
				{
					name: word,
					match: Type.Union([
						ReleaseConditionsSchema,
						Type.Object(
							{
								anyOf: Type.Array(ReleaseConditionsSchema, {
									minItems: 1,
									maxItems: 32,
								}),
							},
							{ additionalProperties: false },
						),
					]),
					acceptAfterMinutes: Type.Integer({ minimum: 0, maximum: 10080 }),
				},
				{ additionalProperties: false },
			),
			{ minItems: 1, maxItems: 32 },
		),
	},
	{ additionalProperties: false },
);
export const AcquisitionProfilesFileSchema = Type.Object(
	{
		version: Type.Literal(1),
		profiles: Type.Array(AcquisitionProfileSchema, { maxItems: 100 }),
	},
	{ additionalProperties: false },
);
export type ReleaseConditions = DeepReadonly<
	Static<typeof ReleaseConditionsSchema>
>;
export type AcquisitionProfile = DeepReadonly<
	Static<typeof AcquisitionProfileSchema>
>;
export const defaultAcquisitionProfileId = "builtin:general";
const resolutions = [1080, 2160];
export const builtinAcquisitionProfiles: [
	AcquisitionProfile,
	AcquisitionProfile,
	AcquisitionProfile,
] = [
	{
		id: defaultAcquisitionProfileId,
		name: "General",
		description:
			"Wait 60 minutes for 1080p / 2160p in any codec or subtitle language; accept 720p after 120 minutes.",
		levels: [
			{ name: "1080p / 2160p", match: { resolutions }, acceptAfterMinutes: 60 },
			{ name: "720p", match: { resolutions: [720] }, acceptAfterMinutes: 120 },
		],
	},
	{
		id: "builtin:efficient",
		name: "Efficient codecs preferred",
		description:
			"Wait 120 minutes for HEVC / AV1 at 1080p / 2160p; accept other codecs after 180 minutes and 720p after 240 minutes.",
		levels: [
			{
				name: "HEVC / AV1",
				match: { resolutions, videoCodecs: ["hevc", "av1"] },
				acceptAfterMinutes: 120,
			},
			{
				name: "Other or unknown codecs",
				match: { resolutions },
				acceptAfterMinutes: 180,
			},
			{ name: "720p", match: { resolutions: [720] }, acceptAfterMinutes: 240 },
		],
	},
	{
		id: "builtin:chinese",
		name: "Chinese subtitles",
		description:
			"Require declared Simplified or Traditional Chinese subtitles; wait 60 minutes for 1080p / 2160p, or 120 minutes for 720p.",
		requirements: { subtitleLanguages: ["zh-Hans", "zh-Hant"] },
		levels: [
			{
				name: "Chinese 1080p / 2160p",
				match: { resolutions },
				acceptAfterMinutes: 60,
			},
			{
				name: "Chinese 720p",
				match: { resolutions: [720] },
				acceptAfterMinutes: 120,
			},
		],
	},
];
export function acquisitionProfileFingerprint(profile: AcquisitionProfile) {
	const { name: _name, description: _description, ...policy } = profile;
	return fingerprint(policy);
}
