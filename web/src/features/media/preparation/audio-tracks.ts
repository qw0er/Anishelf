import type { TFunction } from "i18next";
import type {
	CompatibilityResult,
	PreparationTaskResponse,
} from "../../../shared/api/contracts.js";

export function audioTrackLabel(
	track: CompatibilityResult["audioTracks"][number]["stream"],
	position: number,
	t: TFunction,
	locale: string,
): string {
	let language = track.language;
	if (language) {
		try {
			language =
				new Intl.DisplayNames([locale], { type: "language" }).of(language) ??
				language;
		} catch {
			/* Keep unrecognized language tags readable. */
		}
	}
	const name =
		track.label || language || t("audioTracks.track", { number: position + 1 });
	return [
		name,
		track.label &&
			language &&
			name.toLocaleLowerCase(locale) !== language.toLocaleLowerCase(locale) &&
			language,
		track.codec?.toUpperCase(),
		track.channels && t("audioTracks.channels", { count: track.channels }),
		track.default && t("audioTracks.default"),
	]
		.filter(Boolean)
		.join(" · ");
}

export interface PreparationSource {
	sourceVersion: string;
	audioTracks: CompatibilityResult["audioTracks"][number]["stream"][];
}

/** Missing selection means all source tracks, never an arbitrary prepared subset. */
export function matchesAudioSelection(
	task: PreparationTaskResponse,
	selection: readonly number[] | undefined,
	allTracks?: readonly number[],
): boolean {
	const expected = selection ?? allTracks;
	if (!expected) return task.audioStreamIndices === undefined;
	if (task.audioStreamIndices === undefined) return selection === undefined;
	return (
		expected.length === task.audioStreamIndices.length &&
		expected.every(
			(index, position) => task.audioStreamIndices?.[position] === index,
		)
	);
}

export function preparedWatchPath(task: PreparationTaskResponse): string {
	const query = new URLSearchParams({ version: task.sourceVersion });
	if (task.artifactId) query.set("asset", task.artifactId);
	if (task.audioStreamIndices)
		query.set(
			"audio",
			task.audioStreamIndices.length
				? String(task.audioStreamIndices[0])
				: "none",
		);
	return `/files/${encodeURIComponent(task.fileId)}?${query}`;
}
