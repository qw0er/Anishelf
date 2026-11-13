import type { CatalogSourceResponse } from "../../../shared/api/contracts.js";
import type { Episode } from "./detail-format.js";

/** A file range advances after its last episode, never back into the same file. */
export function continuationContext(
	source: CatalogSourceResponse,
	version: string,
) {
	const [first] = source.associations;
	if (!first || source.sourceVersion !== version) return null;
	const numbers = source.associations.map((item) => Number(item.number));
	if (
		source.associations.some(
			(item) => item.workId !== first.workId || item.kind !== "regular",
		) ||
		numbers.some((number) => !Number.isSafeInteger(number) || number < 1)
	)
		return null;
	const ordered = [...new Set(numbers)].sort((a, b) => a - b);
	if (
		ordered.some(
			(number, index) => index > 0 && number !== (ordered[index - 1] ?? 0) + 1,
		)
	)
		return null;
	return { workId: first.workId, nextNumber: Math.max(...numbers) + 1 };
}

export function continuationEpisode(
	episodes: readonly Episode[],
	number: number,
	fileId: string,
) {
	const targets = episodes.filter(
		(episode) =>
			episode.kind === "regular" && Number(episode.number) === number,
	);
	if (targets.length !== 1) return null;
	const target = targets[0];
	if (!target) return null;
	return {
		...target,
		versions: target.versions.filter(
			(version) => version.available && version.fileId !== fileId,
		),
	};
}
