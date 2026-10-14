import { parse } from "anitomy-ng";

export const normalizeTitle = (value: string) =>
	value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

/** Parse explicit ordinals; bare Roman numerals need a complete-title match. */
export function titleEvidence(value: string) {
	const normalized = value
		.normalize("NFKC")
		.replace(/シーズン\s*(\d+)/gu, "Season $1");
	const elements = parse(normalized);
	const seasons = elements
		.filter((element) => element.kind === "season")
		.map((element) => String(Number(element.value)));
	const title =
		elements.find((element) => element.kind === "title")?.value ?? normalized;
	const roman =
		/(?:^|[\s\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}])(II|III|IV|V|VI|VII|VIII|IX|X)(?=$|[\s:：-])/u.exec(
			normalized,
		);
	const romanSeason = roman
		? String(
				["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"].indexOf(
					roman[1] ?? "",
				) + 2,
			)
		: null;
	return { title, seasons, romanSeason };
}

export function matchingTitle(
	input: string,
	alias: string,
	seasonHints: string[] = [],
): boolean {
	if (normalizeTitle(input) === normalizeTitle(alias)) return true;
	const left = titleEvidence(input);
	const right = titleEvidence(alias);
	const expected = [
		...new Set([
			...left.seasons,
			...seasonHints.map((season) => String(Number(season))),
		]),
	];
	if (
		right.seasons.length &&
		(expected.length !== 1 ||
			right.seasons.some((season) => season !== expected[0]))
	)
		return false;
	return (
		Boolean(normalizeTitle(left.title)) &&
		normalizeTitle(left.title) === normalizeTitle(right.title)
	);
}
