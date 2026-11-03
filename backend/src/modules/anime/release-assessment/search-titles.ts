import type { WorkDetails } from "../external-works/metadata/public.js";

/** One explicit name per category; generic aliases remain matching evidence only. */
export function acquisitionSearchTitles(
	titles: WorkDetails["titles"],
): string[] {
	const valid = titles
		.filter((title) => !/[\r\n\0]/u.test(title.value))
		.map((title) => ({
			...title,
			value: title.value.normalize("NFKC").trim().replace(/\s+/gu, " "),
		}))
		.filter(
			(title) =>
				title.value.length > 0 &&
				title.value.length <= 256 &&
				!/[\r\n\0]/u.test(title.value),
		);
	const role = (title: WorkDetails["titles"][number]) =>
		title.searchKind ?? title.kind;
	const language = (title: WorkDetails["titles"][number]) =>
		title.language?.toLowerCase();
	const selected = [
		valid.find((title) => role(title) === "romaji"),
		valid.find((title) => role(title) === "english") ??
			valid.find((title) => language(title)?.split("-")[0] === "en"),
		valid.find((title) => role(title) === "native"),
		valid.find((title) => language(title) === "zh-hans") ??
			valid.find((title) => language(title) === "zh-hant") ??
			valid.find((title) => language(title)?.split("-")[0] === "zh"),
	];
	const seen = new Set<string>();
	return selected.flatMap((title) => {
		if (!title || seen.has(title.value.toLowerCase())) return [];
		seen.add(title.value.toLowerCase());
		return [title.value];
	});
}
