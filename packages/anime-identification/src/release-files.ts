import { posix } from "node:path";
import { proposeMapping } from "./mapping.ts";
import { rankCandidates } from "./matching.ts";
import type {
	ExtractionEvidence,
	IdentificationResult,
	WorkCandidate,
} from "./model.ts";
import { applyNumberingContext } from "./numbering-context.ts";
import {
	matchesPublicationTitle,
	publicationRangeEvidence,
	type ReleaseParser,
} from "./release.ts";
import { releaseAttributes } from "./release-attributes.ts";

type ReleaseFileIdentification = Pick<
	IdentificationResult,
	"source" | "evidence" | "proposals" | "metadataStatus"
> & { index: number };

function releaseFileEvidence(
	file: ExtractionEvidence,
	release: ExtractionEvidence,
	work: WorkCandidate,
): ExtractionEvidence | null {
	if (file.contentKind !== "regular") return null;
	const seasons = [...new Set([...release.seasons, ...file.seasons])];
	const parts = [...new Set([...release.parts, ...file.parts])];
	if (seasons.length > 1 || parts.length > 1) return null;
	const matchesWork = (title: string) =>
		matchesPublicationTitle(title, work, seasons, parts);
	const releaseMatches = release.titles.some(matchesWork);
	if (release.titles.length && !releaseMatches) return null;
	if (
		work.year !== null &&
		file.years.length &&
		!file.years.includes(String(work.year))
	)
		return null;
	const leafTitles =
		file.titleSources
			?.filter(({ mode }) => mode === "basename")
			.map(({ title }) => title) ?? [];
	const ancestorTitles =
		file.titleSources
			?.filter(({ mode }) => mode === "ancestor")
			.map(({ title }) => title) ?? [];
	if (leafTitles.length && !leafTitles.some(matchesWork)) return null;
	if (
		!leafTitles.length &&
		(ancestorTitles.length
			? !ancestorTitles.some(matchesWork)
			: !releaseMatches)
	)
		return null;
	return {
		...file,
		seasons,
		parts,
		years: [...new Set([...release.years, ...file.years])],
	};
}

/** A validated manifest supplies video paths and indices scoped to this publication. */
export function mapReleaseVideos(
	parser: ReleaseParser,
	title: string,
	work: WorkCandidate,
	videos: readonly { index: number; path: string }[],
) {
	const release = publicationRangeEvidence(
		parser,
		parser.extractRelease(title),
	);
	const extracted = parser.extract(
		videos.map(({ path }) => {
			const ancestors = path.split("/");
			const filename = ancestors.pop() ?? "";
			return { relativePath: path, filename, ancestors };
		}),
	);
	const results = videos.flatMap(
		({ path, index }, offset): ReleaseFileIdentification[] => {
			const file = extracted[offset];
			const evidence = file && releaseFileEvidence(file, release, work);
			if (!evidence) return [];
			const candidate = rankCandidates(evidence, [work])[0];
			if (!candidate) return [];
			return [
				{
					index,
					source: {
						scopeId: "publication",
						relativePath: path,
						fileId: String(index),
						sourceVersion: evidence.contextFingerprint,
					},
					evidence,
					metadataStatus: "searched",
					proposals: [{ candidate, mapping: proposeMapping(evidence, work) }],
				},
			];
		},
	);
	applyNumberingContext(results, posix.dirname);
	const mapped = results.flatMap(({ index, evidence, proposals }) => {
		const proposal = proposals[0];
		if (
			!proposal ||
			proposal.candidate.conflicts.length ||
			proposal.mapping.unresolved.length
		)
			return [];
		const episodes = proposal.mapping.targets
			.filter(({ kind }) => kind === "regular")
			.map(({ number }) => Number(number));
		if (!episodes.length) return [];
		return [
			{
				index,
				episodes,
				attributes: releaseAttributes(evidence),
				numberingOffset: proposal.mapping.numbering?.offset,
			},
		];
	});
	const episodes = [...new Set(mapped.flatMap((video) => video.episodes))].sort(
		(a, b) => a - b,
	);
	return {
		episodes,
		complete:
			work.episodeCount !== null &&
			work.episodeCount > 0 &&
			episodes.length === work.episodeCount,
		videos: mapped,
	};
}
