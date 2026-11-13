import { type Static, Type } from "typebox";
import type { ExtractionEvidence } from "../../src/modules/anime/identification/domain/model.js";
import { releaseAttributes } from "../../src/modules/anime/release-assessment/attributes.js";

const text = Type.String({ minLength: 1 });
const ordinals = Type.Array(Type.Integer({ minimum: 0 }), {
	uniqueItems: true,
});
const numbers = Type.Array(Type.Number({ minimum: 0 }));
const titleLabel = Type.Union([
	text,
	Type.Array(text, { minItems: 2, uniqueItems: true }),
]);
const titleSource = Type.Object({
	title: titleLabel,
	mode: Type.Union([Type.Literal("basename"), Type.Literal("ancestor")]),
	distance: Type.Integer({ minimum: 0 }),
});
export const parsingExpectedSchema = Type.Object(
	{
		rawEpisodes: Type.Optional(numbers),
		selectedEpisodes: Type.Optional(numbers),
		seasons: Type.Optional(ordinals),
		parts: Type.Optional(ordinals),
		years: Type.Optional(ordinals),
		numbering: Type.Optional(
			Type.Union([
				Type.Literal("single"),
				Type.Literal("range"),
				Type.Literal("ambiguous"),
				Type.Literal("unknown"),
			]),
		),
		titles: Type.Optional(
			Type.Object(
				{
					required: Type.Array(titleLabel, { uniqueItems: true }),
					forbidden: Type.Array(text, { uniqueItems: true }),
					exact: Type.Optional(Type.Boolean()),
				},
				{ additionalProperties: false },
			),
		),
		titleSources: Type.Optional(
			Type.Object(
				{
					required: Type.Array(titleSource),
					forbidden: Type.Array(titleSource),
				},
				{ additionalProperties: false },
			),
		),
		contentKind: Type.Optional(
			Type.Union([
				Type.Literal("regular"),
				Type.Literal("special"),
				Type.Literal("ancillary"),
				Type.Literal("unknown"),
			]),
		),
		revision: Type.Optional(Type.Integer({ minimum: 1 })),
	},
	{ additionalProperties: false },
);
type Expected = Static<typeof parsingExpectedSchema>;
export const parsingFields = [
	"rawEpisodes",
	"selectedEpisodes",
	"seasons",
	"parts",
	"years",
	"numbering",
	"titles",
	"titleSources",
	"contentKind",
	"revision",
] as const;
type ParsingField = (typeof parsingFields)[number];

// Surface normalization only: no fuzzy matching, aliases, punctuation stripping or translation.
const surface = (value: string) =>
	value.normalize("NFKC").replace(/\s+/gu, " ").trim();
const sourceKey = (value: { title: string; mode: string; distance: number }) =>
	JSON.stringify([surface(value.title), value.mode, value.distance]);
const variants = (value: string | string[]) =>
	typeof value === "string" ? [value] : value;
const sourceKeys = (value: Static<typeof titleSource>) =>
	variants(value.title).map((title) => sourceKey({ ...value, title }));
const numeric = (values: string[]) =>
	values.map((value) =>
		value.trim() && Number.isFinite(Number(value)) ? Number(value) : value,
	);

export function validateParsingLabels(expected: Expected): void {
	if (expected.titles) {
		const { required, forbidden, exact } = expected.titles;
		if (
			(!required.length && !forbidden.length && !exact) ||
			required
				.flatMap(variants)
				.some((title) => forbidden.map(surface).includes(surface(title)))
		)
			throw new Error("Empty or contradictory title labels.");
	}
	if (expected.titleSources) {
		const { required, forbidden } = expected.titleSources;
		if (
			(!required.length && !forbidden.length) ||
			required.some((source) =>
				sourceKeys(source).some((key) =>
					forbidden.flatMap(sourceKeys).includes(key),
				),
			) ||
			[...required, ...forbidden].some(
				(source) => source.mode === "basename" && source.distance !== 0,
			)
		)
			throw new Error("Empty or contradictory title-source labels.");
	}
}

export function parsedFields(evidence: ExtractionEvidence) {
	return {
		rawEpisodes: numeric(evidence.rawEpisodes),
		selectedEpisodes: numeric(evidence.selectedEpisodes ?? []),
		seasons: evidence.seasons.map(Number).sort((a, b) => a - b),
		parts: evidence.parts.map(Number).sort((a, b) => a - b),
		years: evidence.years.map(Number).sort((a, b) => a - b),
		numbering: evidence.numbering,
		titles: evidence.titles,
		titleSources: evidence.titleSources ?? [],
		contentKind: evidence.contentKind,
		revision: releaseAttributes(evidence).revision,
	};
}

export function titleChecks(
	expected: Expected,
	actual: ReturnType<typeof parsedFields> | null,
) {
	const titles = new Set(actual?.titles.map(surface));
	const sources = new Set(actual?.titleSources.map(sourceKey));
	return {
		titles: {
			required: expected.titles?.required.length ?? 0,
			matched:
				expected.titles?.required.filter((value) =>
					variants(value).some((title) => titles.has(surface(title))),
				).length ?? 0,
			forbidden: expected.titles?.forbidden.length ?? 0,
			violations:
				expected.titles?.forbidden.filter((value) => titles.has(surface(value)))
					.length ?? 0,
		},
		sources: {
			required: expected.titleSources?.required.length ?? 0,
			matched:
				expected.titleSources?.required.filter((value) =>
					sourceKeys(value).some((key) => sources.has(key)),
				).length ?? 0,
			forbidden: expected.titleSources?.forbidden.length ?? 0,
			violations:
				expected.titleSources?.forbidden.filter((value) =>
					sourceKeys(value).some((key) => sources.has(key)),
				).length ?? 0,
		},
	};
}

export function parsingFieldMatches(
	field: ParsingField,
	expected: Expected,
	actual: ReturnType<typeof parsedFields> | null,
): boolean {
	if (!actual) return false;
	if (field === "titles" && expected.titles) {
		const checks = titleChecks(expected, actual).titles;
		return (
			checks.required === checks.matched &&
			checks.violations === 0 &&
			(!expected.titles.exact ||
				actual.titles
					.map(surface)
					.every((title) =>
						expected.titles?.required
							.flatMap(variants)
							.map(surface)
							.includes(title),
					))
		);
	}
	if (field === "titleSources" && expected.titleSources) {
		const checks = titleChecks(expected, actual).sources;
		return checks.required === checks.matched && checks.violations === 0;
	}
	const value = expected[field];
	return (
		JSON.stringify(
			["seasons", "parts", "years"].includes(field) && Array.isArray(value)
				? [...value].sort((a, b) => Number(a) - Number(b))
				: value,
		) === JSON.stringify(actual[field])
	);
}
