import type { MetadataTitle } from "./model.js";
import type { WorkDetails, WorkSummary } from "./source-model.js";

export type NameDecision = {
	state: "confirmed" | "conflict" | "insufficient";
	reasons: string[];
	matchedNames: number;
};
const primary = (title: MetadataTitle) => title.kind !== "alias";
const ordinal = (text: string) =>
	text.replace(/(\d+)(?:st|nd|rd|th)\b/gu, "$1");
const base = (text: string) => ordinal(text.normalize("NFKC").toLowerCase());
function scopes(text: string) {
	const value = base(text);
	const roman =
		/(?:^|[\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])(II|III|IV|V|VI|VII|VIII|IX|X)(?=$|[\s:：-])/u.exec(
			text.normalize("NFKC"),
		);
	const romanSeason = roman
		? String(
				["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"].indexOf(
					roman[1] ?? "",
				) + 2,
			)
		: null;
	const matches = (pattern: RegExp) =>
		[...value.matchAll(pattern)]
			.map((match) => String(Number(match[1])))
			.sort();
	return {
		season: [
			...new Set([
				...(romanSeason ? [romanSeason] : []),
				...matches(/第?\s*(\d+)\s*[季期]/gu),
				...matches(/(?:season|シーズン)\s*(\d+)/gu),
				...matches(/\b(\d+)\s+season\b/gu),
			]),
		],
		part: [
			...new Set([
				...matches(/(?:part|cour)\s*(\d+)/gu),
				...matches(/\b(\d+)\s+(?:part|cour)\b/gu),
				...matches(/第\s*(\d+)\s*部/gu),
			]),
		],
		stage: [
			...new Set(
				[...value.matchAll(/((?:\d+\s*(?:&|and|-)?\s*)+)stage\b/gu)]
					.flatMap((match) => match[1]?.match(/\d+/gu) ?? [])
					.map((number) => String(Number(number)))
					.sort(),
			),
		],
	};
}
function key(text: string, movie: boolean) {
	return base(text)
		.replace(
			scopes(text).season.length
				? /【(?![^】]*(?:part|cour|前編|後編|完結|final))[^】]*(?:編|篇)】/giu
				: /$^/u,
			"",
		)
		.replace(movie ? /^(?:劇場版|映画|gekijouban\b)\s*/u : /$^/u, "")
		.replace(/第?\s*(\d+)\s*[季期]/gu, " season $1 ")
		.replace(/シーズン\s*(\d+)/gu, " season $1 ")
		.replace(/\b(\d+)\s+season\b/gu, " season $1 ")
		.replace(/[’‘]/gu, "'")
		.replace(/[^\p{L}\p{N}]+/gu, "");
}
function tokens(text: string) {
	return base(text)
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.split(/\s+/u)
		.filter(Boolean)
		.sort();
}
function names(work: WorkSummary) {
	return work.titles
		.filter((title) => title.value.trim() && !title.searchKind)
		.map((title) => ({
			...title,
			key: key(title.value, work.format === "MOVIE"),
		}));
}
function scopeConflict(left: WorkSummary, right: WorkSummary) {
	for (const category of ["season", "part", "stage"] as const) {
		const collect = (work: WorkSummary) =>
			[
				...new Set(
					work.titles
						.filter(primary)
						.flatMap((title) => scopes(title.value)[category]),
				),
			].sort();
		const a = collect(left),
			b = collect(right);
		if (a.length && b.length && JSON.stringify(a) !== JSON.stringify(b))
			return `${category}-conflict`;
	}
	const arcs = (work: WorkSummary) =>
		[
			...new Set(
				work.titles
					.filter(primary)
					.flatMap((title) =>
						[...base(title.value).matchAll(/【([^】]*[編篇])】/gu)].map(
							(match) => match[1]?.replace("篇", "編"),
						),
					),
			),
		].sort();
	const aArcs = arcs(left),
		bArcs = arcs(right);
	if (
		aArcs.length &&
		bArcs.length &&
		JSON.stringify(aArcs) !== JSON.stringify(bArcs)
	)
		return "arc-conflict";
	for (const a of left.titles.filter(primary))
		for (const b of right.titles.filter(primary)) {
			const aKey = key(a.value, left.format === "MOVIE"),
				bKey = key(b.value, right.format === "MOVIE");
			const aNumbers = aKey.match(/\d+/gu),
				bNumbers = bKey.match(/\d+/gu);
			if (
				aNumbers &&
				bNumbers &&
				aKey.replace(/\d+/gu, "#") === bKey.replace(/\d+/gu, "#") &&
				JSON.stringify(aNumbers) !== JSON.stringify(bNumbers)
			)
				return "title-number-conflict";
		}
	const derivative = (work: WorkSummary) =>
		[
			...new Set(
				work.titles
					.filter(primary)
					.flatMap((title) =>
						[
							...base(title.value).matchAll(
								/\b(?:pv|cm|trailer|recap|compilation)\b|予告|総集編|アニメcm|ミニアニメ|前[編篇]|後[編篇]|完結[編篇]/gu,
							),
						].map(([marker]) => marker.replace("篇", "編")),
					),
			),
		].sort();
	return JSON.stringify(derivative(left)) !== JSON.stringify(derivative(right))
		? "release-scope-conflict"
		: null;
}
const family = (format: string | null) =>
	format === "TV_SHORT" ? "TV" : format;
function day(work: WorkDetails): number | null {
	const date = work.startDate;
	if (!date?.year || !date.month || !date.day) return null;
	const value = new Date(Date.UTC(date.year, date.month - 1, date.day));
	return value.getUTCFullYear() === date.year &&
		value.getUTCMonth() + 1 === date.month &&
		value.getUTCDate() === date.day
		? value.getTime() / 86400000
		: null;
}

/** Missing facts remain unknown. Explicit release conflicts override any title evidence. */
export function nameCorrespondence(
	left: WorkDetails,
	right: WorkDetails,
): NameDecision {
	const malformed = (work: WorkDetails) => {
		const date = work.startDate;
		return Boolean(
			date &&
				((date.month !== null && (date.month < 1 || date.month > 12)) ||
					(date.day !== null && (date.day < 1 || date.day > 31)) ||
					(date.year && date.month && date.day && day(work) === null)),
		);
	};
	if (malformed(left) || malformed(right))
		return {
			state: "insufficient",
			reasons: ["invalid-date"],
			matchedNames: 0,
		};
	const reasons: string[] = [];
	const conflict = scopeConflict(left, right);
	if (conflict)
		return { state: "conflict", reasons: [conflict], matchedNames: 0 };
	const distributionDifference =
		[left.format, right.format].includes("TV") &&
		[left.format, right.format].includes("ONA");
	if (
		left.format &&
		right.format &&
		family(left.format) !== family(right.format) &&
		!distributionDifference
	)
		return { state: "conflict", reasons: ["format-conflict"], matchedNames: 0 };
	const aDay = day(left),
		bDay = day(right);
	const closeDate =
		aDay !== null && bDay !== null && Math.abs(aDay - bDay) <= 1;
	const aYear = left.startDate?.year ?? left.year,
		bYear = right.startDate?.year ?? right.year;
	if (aYear && bYear && aYear !== bYear && !closeDate)
		return { state: "conflict", reasons: ["year-conflict"], matchedNames: 0 };
	const aNames = names(left),
		bNames = names(right);
	const exact = new Set<string>();
	let primaryExact = false;
	let reordered = false;
	for (const a of aNames)
		for (const b of bNames) {
			if (!primary(a) && !primary(b)) continue;
			if (a.key === b.key && a.key) {
				exact.add(a.key);
				if (primary(a) && primary(b)) primaryExact = true;
			} else if (primary(a) && primary(b)) {
				const aTokens = tokens(a.value),
					bTokens = tokens(b.value);
				if (
					aTokens.length >= 4 &&
					JSON.stringify(aTokens) === JSON.stringify(bTokens)
				)
					reordered = true;
			}
		}
	const sameYear = Boolean(aYear && aYear === bYear);
	let sameFormat = Boolean(
		left.format && right.format && family(left.format) === family(right.format),
	);
	const sameCount = Boolean(
		left.episodeCount && left.episodeCount === right.episodeCount,
	);
	const sameScope = (["season", "part", "stage"] as const).some((category) => {
		const a = left.titles
			.filter(primary)
			.flatMap((title) => scopes(title.value)[category]);
		const b = right.titles
			.filter(primary)
			.flatMap((title) => scopes(title.value)[category]);
		return (
			a.length > 0 &&
			b.length > 0 &&
			JSON.stringify([...new Set(a)].sort()) ===
				JSON.stringify([...new Set(b)].sort())
		);
	});
	if (distributionDifference) {
		if (!sameScope || exact.size < 2)
			return {
				state: "insufficient",
				reasons: ["distribution-format-uncorroborated"],
				matchedNames: exact.size,
			};
		sameFormat = true;
	}
	if (!primaryExact && !(reordered && exact.size >= 2 && sameScope))
		return {
			state: "insufficient",
			reasons: ["primary-name-unconfirmed"],
			matchedNames: exact.size,
		};
	if (
		!(
			closeDate ||
			(sameYear && sameFormat) ||
			(exact.size >= 2 && (sameYear || sameFormat)) ||
			(sameScope && sameFormat)
		)
	)
		return {
			state: "insufficient",
			reasons: ["corroboration-missing"],
			matchedNames: exact.size,
		};
	if (
		aDay !== null &&
		bDay !== null &&
		Math.abs(aDay - bDay) > 31 &&
		exact.size < 2
	)
		return {
			state: "insufficient",
			reasons: ["large-date-disagreement"],
			matchedNames: exact.size,
		};
	if (!sameCount)
		reasons.push(
			left.episodeCount && right.episodeCount
				? "episode-count-disagreement"
				: "episode-count-missing",
		);
	if (!closeDate)
		reasons.push(
			aDay !== null && bDay !== null ? "date-disagreement" : "date-incomplete",
		);
	if (left.format !== right.format)
		reasons.push(sameFormat ? "compatible-format-family" : "format-missing");
	if (reordered && !primaryExact) reasons.push("title-order-corroborated");
	return {
		state: "confirmed",
		reasons: ["primary-name-confirmed", ...reasons],
		matchedNames: exact.size,
	};
}

/** Broad candidate discovery cannot dismiss a title-related competitor for missing fields. */
export function relatedNames(left: WorkSummary, right: WorkSummary): boolean {
	const a = names(left),
		b = names(right);
	return a.some((one) =>
		b.some(
			(two) =>
				(primary(one) || primary(two)) &&
				(one.key === two.key ||
					(tokens(one.value).length >= 4 &&
						JSON.stringify(tokens(one.value)) ===
							JSON.stringify(tokens(two.value)))),
		),
	);
}
export function nameFingerprint(work: WorkDetails): string | null {
	if (!work.titles.some((title) => primary(title) && title.value.trim()))
		return null;
	return JSON.stringify([
		work.titles
			.filter((title) => !title.searchKind)
			.map((title) => [title.value, title.kind, title.language])
			.sort(),
		work.startDate,
		work.year,
		work.format,
		work.episodeCount,
	]);
}
