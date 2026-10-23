import type {
	LocalWorkDetailResponse,
	MetadataDetailsResponse,
} from "../../../shared/api/contracts.js";
export type Episode = LocalWorkDetailResponse["episodes"][number];
export type Version = Episode["versions"][number];
export function safeLink(value: string | null): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:"
			? url.href
			: undefined;
	} catch {
		return undefined;
	}
}
export function releaseInfo(version: Version): string {
	return [
		...new Set(
			version.evidence.inputs.flatMap((input) =>
				input.elements
					.filter((element) =>
						[
							"ReleaseGroup",
							"ReleaseVersion",
							"Language",
							"VideoResolution",
							"VideoTerm",
							"AudioTerm",
							"Source",
							"release_group",
							"release_version",
							"language",
							"video_resolution",
							"video_term",
							"audio_term",
							"source",
						].includes(element.kind),
					)
					.map((element) => element.value),
			),
		),
	].join(" · ");
}
export function fuzzyDate(
	date: LocalWorkDetailResponse["metadata"]["data"]["startDate"],
): string | null {
	if (!date?.year) return null;
	return [
		date.year,
		date.month?.toString().padStart(2, "0"),
		date.day?.toString().padStart(2, "0"),
	]
		.filter((value) => value !== null && value !== undefined)
		.join("-");
}

export function airedEpisodeCount(
	info: Pick<
		MetadataDetailsResponse["data"],
		"status" | "episodeCount" | "nextAiringEpisode"
	>,
	now = Date.now(),
): number | null {
	if (info.status === "NOT_YET_RELEASED") return 0;
	if (info.status === "FINISHED") return info.episodeCount;
	const next = info.nextAiringEpisode;
	if (!next) return null;
	const aired = Math.max(
		0,
		next.episode - (next.airingAt * 1000 > now ? 1 : 0),
	);
	return info.episodeCount === null
		? aired
		: Math.min(aired, info.episodeCount);
}
