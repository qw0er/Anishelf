import { Type } from "typebox";

const text = Type.String({ minLength: 1 });
const nullableText = Type.Union([text, Type.Null()]);
const strings = Type.Array(Type.String());
const mode = Type.Union([
	Type.Literal("basename"),
	Type.Literal("ancestor"),
	Type.Literal("path"),
	Type.Literal("together"),
]);
export const evidenceSchema = Type.Object({
	parser: text,
	parserVersion: text,
	normalizationVersion: text,
	contextFingerprint: text,
	originalName: text,
	relativePath: text,
	inputs: Type.Array(
		Type.Object({
			mode,
			input: text,
			elements: Type.Array(
				Type.Object({
					kind: text,
					value: Type.String(),
					position: Type.Integer({ minimum: 0 }),
				}),
			),
		}),
	),
	titles: strings,
	titleSources: Type.Optional(
		Type.Array(
			Type.Object({
				title: text,
				mode,
				distance: Type.Integer({ minimum: 0 }),
			}),
		),
	),
	years: strings,
	seasons: strings,
	parts: strings,
	rawEpisodes: strings,
	selectedEpisodes: Type.Optional(strings),
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
export const candidateSchema = Type.Object({
	reference: Type.Object({ id: text }),
	snapshotId: text,
	displayTitle: Type.Optional(text),
	titles: Type.Array(text, { minItems: 1 }),
	titleVariants: Type.Optional(
		Type.Array(
			Type.Object({
				value: text,
				kind: Type.Union([Type.Literal("primary"), Type.Literal("alias")]),
				language: nullableText,
			}),
		),
	),
	year: Type.Union([Type.Integer(), Type.Null()]),
	format: nullableText,
	episodeCount: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
	season: nullableText,
	part: nullableText,
});
