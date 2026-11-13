import { parse, parse_path, parse_together } from "anitomy-ng";
import type { ExtractionElement } from "./domain/model.js";

const ordinals: Record<string, number> = {
	一: 1,
	二: 2,
	两: 2,
	三: 3,
	四: 4,
	五: 5,
	六: 6,
	七: 7,
	八: 8,
	九: 9,
	十: 10,
};
const seasonPattern =
	/第\s*([0-9０-９]+|[一二两三四五六七八九十])\s*[季期]|シーズン\s*([0-9０-９]+)/gu;

function ordinal(token: string): string | null {
	const number = ordinals[token] ?? Number(token);
	return Number.isSafeInteger(number) && number > 0 ? String(number) : null;
}

/** The sole runtime binding to anitomy-ng. Raw elements remain unchanged. */
export const animeNameParser = {
	parse,
	parsePath: parse_path,
	parseTogether: parse_together,
	/** Reuse filename parsing, restoring title words and retaining ambiguous numbers. */
	title(value: string) {
		const normalized = value.normalize("NFKC");
		const elements = parse(normalized);
		const seasons: string[] = [];
		const parts: string[] = [];
		let title = normalized;
		let current = elements;
		// Reparse after removing an ordinal so a second, contradictory marker
		// cannot hide behind the first marker's filename interpretation.
		while (true) {
			// Parser positions count Unicode codepoints, not JavaScript UTF-16 units.
			const characters = [...title];
			for (const element of current) {
				if (element.kind !== "season" && element.kind !== "part") continue;
				const number = ordinal(element.value);
				if (!number) continue;
				const before = characters.slice(0, element.position).join("");
				// The library may normalize a Roman ordinal (II) to an Arabic value (2).
				const token =
					characters
						.slice(element.position)
						.join("")
						.match(/^(?:\d+|[IVX]+)/iu)?.[0] ?? element.value;
				const end = element.position + [...token].length;
				const after = characters.slice(end).join("");
				const prefix =
					before.match(
						element.kind === "season"
							? /(?:\bS(?:eason)?[\s._-]*|第\s*|シーズン\s*)$/iu
							: /(?:\b(?:Part|Cour)\s*|第\s*)$/iu,
					)?.[0] ?? "";
				const suffix =
					after.match(
						element.kind === "season"
							? /^(?:(?:st|nd|rd|th)\s+Season\b|\s*[季期])/iu
							: /^\s*部/u,
					)?.[0] ?? "";
				if (!prefix && !suffix) continue;
				(element.kind === "season" ? seasons : parts).push(number);
				characters.fill(
					" ",
					element.position - [...prefix].length,
					end + [...suffix].length,
				);
			}
			const stripped = characters.join("");
			if (stripped === title) break;
			title = stripped;
			current = parse(title);
		}
		// Supplement only localized/part forms the library does not recognize.
		title = title.replace(seasonPattern, (match, chinese, japanese) => {
			const number = ordinal(chinese ?? japanese ?? "");
			if (!number) return match;
			seasons.push(number);
			return " ";
		});
		title = title.replace(
			/\b(?:Part|Cour)\s*(\d+)\b|第\s*([0-9]+|[一二两三四五六七八九十])\s*部/giu,
			(match, plain, chinese) => {
				const number = ordinal(plain ?? chinese ?? "");
				if (!number) return match;
				parts.push(number);
				return " ";
			},
		);
		const episode = elements.find((element) => element.kind === "episode");
		const number = episode ? ordinal(episode.value) : null;
		const prefix = episode
			? [...normalized].slice(0, episode.position).join("")
			: "";
		// A bare trailing episode token in a metadata name is a possible sequel
		// number, never an episode or a verified season without source evidence.
		const numberedTitle =
			episode &&
			number &&
			Number(number) > 1 &&
			elements.filter((element) => element.kind === "episode").length === 1 &&
			elements.some((element) => element.kind === "title") &&
			/\s$/u.test(prefix) &&
			!normalized.slice(prefix.length + episode.value.length).trim() &&
			!seasons.length &&
			!parts.length
				? { title: prefix.trim(), number }
				: null;
		return {
			title: title
				.replace(/\(\s*\)|\[\s*\]/gu, " ")
				.replace(/\s+/gu, " ")
				.trim(),
			seasons: [...new Set(seasons)],
			parts: [...new Set(parts)],
			numberedTitle,
		};
	},
	/** Distinguish explicit filename syntax; parent batch ranges never map episodes. */
	numbering(value: string, raw: ExtractionElement[]) {
		const episodes = raw.filter((element) => element.kind === "episode");
		const tokens = episodes.map((element) => element.value);
		// Anitomy may absorb the start of a descending range into the title.
		const descending =
			/(?:^|[-[])\s*(\d+)\s*[-–]\s*(\d+)(?=$|[\s.[\]()])/u.exec(value);
		if (
			descending &&
			!raw.some(
				(element) => element.kind === "year" && element.value === descending[1],
			) &&
			Number(descending[1]) > Number(descending[2]) &&
			tokens.includes(descending[2] ?? "")
		)
			return { kind: "ambiguous" as const, tokens };
		if (episodes.length === 2) {
			const [first, last] = episodes;
			if (
				first &&
				last &&
				/^\d+$/u.test(first.value) &&
				/^\d+$/u.test(last.value) &&
				/^\s*[-–]\s*$/u.test(
					value.slice(first.position + first.value.length, last.position),
				)
			)
				return { kind: "range" as const, tokens };
			const local = /\bS(\d+)E(\d+)\b/iu.exec(value);
			if (
				local &&
				first &&
				last &&
				last.value === local[2] &&
				last.position ===
					local.index + local[0].length - (local[2]?.length ?? 0) &&
				/^\d+$/u.test(first.value) &&
				Number(first.value) >= Number(last.value)
			)
				return { kind: "single" as const, tokens: [last.value] };
		}
		return {
			kind:
				tokens.length === 1
					? ("single" as const)
					: tokens.length
						? ("ambiguous" as const)
						: ("unknown" as const),
			tokens,
		};
	},
	/** Small, provider-independent corrections; never infer a work or offset. */
	adapt(value: string, raw: ExtractionElement[]): ExtractionElement[] {
		const elements = raw.map((element) => ({ ...element }));
		for (const part of animeNameParser.title(value).parts)
			elements.push({ kind: "part", value: part, position: 0 });
		const dubbed = raw.some(
			(element) =>
				element.kind === "audio_term" && /^dubbed$/iu.test(element.value),
		);
		for (const match of value.matchAll(seasonPattern)) {
			const token = (match[1] ?? match[2] ?? "").normalize("NFKC");
			const season = ordinals[token] ?? Number(token);
			if (season > 0 && Number.isInteger(season))
				elements.push({
					kind: "season",
					value: String(season),
					position: match.index,
				});
		}
		for (const element of elements) {
			if (element.kind !== "title") continue;
			element.value = element.value.replace(seasonPattern, " ");
			if (dubbed)
				element.value = element.value.replace(
					/\s+(?:Chinese|English|Japanese)\s*$/iu,
					"",
				);
			element.value = element.value.replace(/\s+/gu, " ").trim();
		}
		// Ignore a trailing parenthesized textual annotation when forming a query.
		// Retain the complete title as evidence; never invent a translation.
		for (const element of [...elements]) {
			if (element.kind !== "title") continue;
			const annotation = /^(.+?)\s+\([^()]+\)\s*$/u.exec(element.value);
			if (annotation?.[1])
				elements.push({
					kind: "title",
					value: annotation[1],
					position: element.position,
				});
		}
		const ancillary =
			/^(?:\[[^\]]+\]\s*)*(?:menu|nc[\s._-]*(?:opening|ending))(?:$|[\s[\]()._-]|\d)|\[(?:menu|trailer\s*\d*)\]/iu.exec(
				value,
			);
		if (ancillary)
			elements.push({
				kind: "type",
				value: "ANCILLARY",
				position: ancillary.index,
			});
		// A space-delimited Han/Latin pair is two title candidates, not a translation.
		for (const element of [...elements]) {
			if (element.kind !== "title") continue;
			const pair = /^([\p{Script=Han}\p{N}·：:！？!?]+)\s+([A-Za-z].*)$/u.exec(
				element.value,
			);
			if (pair)
				for (const title of pair.slice(1))
					elements.push({
						kind: "title",
						value: title,
						position: element.position,
					});
		}
		return elements.filter((element) => element.value.length > 0);
	},
};
