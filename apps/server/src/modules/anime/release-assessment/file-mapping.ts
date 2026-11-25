import { posix } from "node:path";
import { subtitleExtensionFormats } from "@anishelf/contracts/subtitles";
import { getVideoMimeType } from "../../resources/public.js";
import {
	type ExtractionEvidence,
	proposeMapping,
	rankCandidates,
} from "../identification/public.js";
import { releaseAttributes } from "./attributes.js";
import type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
	ReleaseFileCoverage,
	ReleaseParser,
} from "./public.js";
import { matchesPublicationTitle } from "./title.js";

type ManifestFile = Parameters<
	NonNullable<ReleaseAssessmentApi["mapReleaseFiles"]>
>[2][number];

function regularEpisodes(
	file: ExtractionEvidence,
	release: ExtractionEvidence,
	work: AcquisitionTarget["work"],
): number[] {
	if (file.contentKind !== "regular") return [];
	const seasons = [...new Set([...release.seasons, ...file.seasons])];
	const parts = [...new Set([...release.parts, ...file.parts])];
	if (seasons.length > 1 || parts.length > 1) return [];
	const matchesWork = (title: string) =>
		matchesPublicationTitle(title, work, seasons, parts);
	const releaseMatches = release.titles.some(matchesWork);
	if (release.titles.length && !releaseMatches) return [];
	if (
		work.year !== null &&
		file.years.length &&
		!file.years.includes(String(work.year))
	)
		return [];
	const leafTitles =
		file.titleSources
			?.filter(({ mode }) => mode === "basename")
			.map(({ title }) => title) ?? [];
	const ancestorTitles =
		file.titleSources
			?.filter(({ mode }) => mode === "ancestor")
			.map(({ title }) => title) ?? [];
	if (leafTitles.length && !leafTitles.some(matchesWork)) return [];
	if (
		!leafTitles.length &&
		(ancestorTitles.length
			? !ancestorTitles.some(matchesWork)
			: !releaseMatches)
	)
		return [];
	const evidence = {
		...file,
		seasons,
		parts,
		years: [...new Set([...release.years, ...file.years])],
	};
	const candidate = rankCandidates(evidence, [work])[0];
	if (!candidate || candidate.conflicts.length) return [];
	const mapping = proposeMapping(evidence, work);
	if (mapping.unresolved.length) return [];
	return mapping.targets
		.filter(({ kind }) => kind === "regular")
		.map(({ number }) => Number(number));
}

function stem(path: string) {
	return path.slice(0, -posix.extname(path).length);
}

export function mapReleaseFiles(
	parser: ReleaseParser,
	release: ExtractionEvidence,
	target: AcquisitionTarget,
	files: readonly ManifestFile[],
): ReleaseFileCoverage {
	const videos = files.filter(({ path }) => getVideoMimeType(path));
	const evidence = parser.extract(
		videos.map(({ path }) => {
			const ancestors = path.split("/");
			const filename = ancestors.pop() ?? "";
			return { relativePath: path, ancestors, filename };
		}),
	);
	const versions: ReleaseFileCoverage["videos"] = [];
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
	for (const [offset, file] of videos.entries()) {
		const extracted = evidence[offset];
		if (!extracted) continue;
		const episodes = regularEpisodes(extracted, release, target.work);
		if (!episodes.length) continue;
		versions.push({
			index: file.index,
			episodes,
			subtitleIndices: sidecars.get(file.index) ?? [],
			attributes: releaseAttributes(extracted),
		});
	}
	const episodes = [
		...new Set(versions.flatMap((video) => video.episodes)),
	].sort((a, b) => a - b);
	return {
		episodes,
		complete:
			target.work.episodeCount !== null &&
			target.work.episodeCount > 0 &&
			episodes.length === target.work.episodeCount,
		videos: versions,
	};
}
