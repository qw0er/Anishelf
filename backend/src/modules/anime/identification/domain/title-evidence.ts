import { Converter } from "opencc-js/t2cn";
import { animeNameParser } from "../anitomy-adapter.js";

const simplify = Converter({ from: "t", to: "cn" });

export const normalizeTitle = (value: string) =>
	simplify(value.normalize("NFKC").toLowerCase().replace(/[×✕]/gu, "x"))
		.replace(/[^\p{L}\p{N}]+/gu, "")
		.trim();

/** Parse explicit ordinals; bare Roman numerals need a complete-title match. */
export function titleEvidence(value: string) {
	const normalized = value.normalize("NFKC");
	const { title, seasons, parts } = animeNameParser.title(normalized);
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
	return { title, seasons, parts, romanSeason };
}

export function matchingTitle(
	input: string,
	alias: string,
	seasonHints: string[] = [],
	partHints: string[] = [],
): boolean {
	const left = titleEvidence(input);
	const right = titleEvidence(alias);
	const expected = [
		...new Set([
			...left.seasons,
			...seasonHints.map((season) => String(Number(season))),
		]),
	];
	const expectedParts = [
		...new Set([
			...left.parts,
			...partHints.map((part) => String(Number(part))),
		]),
	];
	if (
		right.parts.length &&
		(expectedParts.length !== 1 ||
			right.parts.some((part) => part !== expectedParts[0]))
	)
		return false;
	if (
		right.seasons.length &&
		(expected.length !== 1 ||
			right.seasons.some((season) => season !== expected[0]))
	)
		return false;
	if (normalizeTitle(input) === normalizeTitle(alias)) return true;
	return (
		Boolean(normalizeTitle(left.title)) &&
		normalizeTitle(left.title) === normalizeTitle(right.title)
	);
}
