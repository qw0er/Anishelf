import type { ReleaseAttributes } from "../../../anime/public.js";
import type { ReleaseConditions } from "./profiles.js";

const normalize = (value: string) =>
	value.normalize("NFKC").trim().toLowerCase();
export function matchesRelease(
	condition: ReleaseConditions,
	attributes: ReleaseAttributes | undefined,
	title: string,
	seeders: number | null,
): boolean {
	for (const key of [
		"subtitleLanguages",
		"subtitleFormats",
		"resolutions",
		"videoCodecs",
		"sources",
		"releaseGroups",
	] as const) {
		const expected = condition[key];
		if (
			expected &&
			!expected.some((value) =>
				attributes?.[key].some(
					(actual) => normalize(String(actual)) === normalize(String(value)),
				),
			)
		)
			return false;
	}
	const groups = attributes?.releaseGroups.map(normalize) ?? [];
	if (
		condition.excludeReleaseGroups?.some((group) =>
			groups.includes(normalize(group)),
		)
	)
		return false;
	const normalizedTitle = normalize(title);
	if (
		condition.includeKeywords?.some(
			(word) => !normalizedTitle.includes(normalize(word)),
		)
	)
		return false;
	if (
		condition.excludeKeywords?.some((word) =>
			normalizedTitle.includes(normalize(word)),
		)
	)
		return false;
	if (condition.minSeeders !== undefined) {
		if (seeders === null) return condition.unknownSeeders === "allow";
		if (seeders < condition.minSeeders) return false;
	}
	return true;
}
