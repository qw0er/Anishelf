import { posix } from "node:path";
import {
	mapReleaseVideos,
	type ReleaseParser,
} from "@anishelf/anime-identification";
import { subtitleExtensionFormats } from "@anishelf/contracts/subtitles";
import type { Logger } from "pino";
import { getVideoMimeType } from "../../resources/public.js";
import type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
	ReleaseFileCoverage,
} from "./public.js";

type ManifestFile = Parameters<
	NonNullable<ReleaseAssessmentApi["mapReleaseFiles"]>
>[2][number];

function stem(path: string) {
	return path.slice(0, -posix.extname(path).length);
}

export function mapReleaseFiles(
	parser: ReleaseParser,
	title: string,
	target: AcquisitionTarget,
	files: readonly ManifestFile[],
	logger?: Logger,
): ReleaseFileCoverage {
	const videos = files.filter(({ path }) => getVideoMimeType(path));
	const videosByStem = new Map<string, number[]>();
	for (const file of videos) {
		const key = stem(file.path);
		const matching = videosByStem.get(key) ?? [];
		matching.push(file.index);
		videosByStem.set(key, matching);
	}
	const sidecars = new Map<number, number[]>();
	for (const file of files) {
		if (
			!Object.hasOwn(
				subtitleExtensionFormats,
				posix.extname(file.path).toLowerCase(),
			)
		)
			continue;
		let key = stem(file.path);
		const directoryLength = key.lastIndexOf("/") + 1;
		while (key.length > directoryLength) {
			const matches = videosByStem.get(key);
			if (matches) {
				const index = matches[0];
				if (matches.length === 1 && index !== undefined) {
					const indices = sidecars.get(index) ?? [];
					indices.push(file.index);
					sidecars.set(index, indices);
				}
				break;
			}
			const dot = key.lastIndexOf(".");
			if (dot < directoryLength || dot === key.length - 1) break;
			key = key.slice(0, dot);
		}
	}
	const mapped = mapReleaseVideos(parser, title, target.work, videos);
	const converted = mapped.videos.filter(
		({ numberingOffset }) => numberingOffset !== undefined,
	).length;
	if (converted)
		logger?.debug(
			{
				event: "acquisition.manifest_numbering_offsets_applied",
				count: converted,
			},
			"Corroborated directory offsets resolved torrent episode numbering.",
		);

	return {
		episodes: mapped.episodes,
		complete: mapped.complete,
		videos: mapped.videos.map(({ index, episodes, attributes }) => ({
			index,
			episodes,
			subtitleIndices: sidecars.get(index) ?? [],
			attributes,
		})),
	};
}
