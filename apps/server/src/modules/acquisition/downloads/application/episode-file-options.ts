import type {
	ReleaseAssessmentApi,
	ReleaseAttributes,
} from "../../../anime/public.js";
import type {
	ManifestPreview,
	ManifestPreviewCandidate,
} from "../../manifest-preview.js";
import { selectCandidates } from "../../release-selection.js";
import type { ReleaseEvidence } from "../../sources/public.js";
import type { EpisodeFilePlan } from "../domain/model.js";

function versionAttributes(
	declared: ReleaseAttributes | undefined,
	file: ReleaseAttributes,
): ReleaseAttributes | null {
	for (const field of ["resolutions", "videoCodecs", "sources"] as const)
		if (
			declared?.[field].length &&
			file[field].length &&
			!file[field].some((value) =>
				declared[field].some((other) => other === value),
			)
		)
			return null;
	return {
		resolutions: file.resolutions.length
			? file.resolutions
			: (declared?.resolutions ?? []),
		videoCodecs: file.videoCodecs.length
			? file.videoCodecs
			: (declared?.videoCodecs ?? []),
		sources: file.sources.length ? file.sources : (declared?.sources ?? []),
		releaseGroups: file.releaseGroups.length
			? file.releaseGroups
			: (declared?.releaseGroups ?? []),
		subtitleLanguages: [
			...new Set([
				...(declared?.subtitleLanguages ?? []),
				...file.subtitleLanguages,
			]),
		],
		subtitleFormats: [
			...new Set([
				...(declared?.subtitleFormats ?? []),
				...file.subtitleFormats,
			]),
		],
		revision: Math.max(file.revision, declared?.revision ?? 1),
	};
}

export function episodeFileOptions(input: {
	inspection: readonly ManifestPreviewCandidate[];
	previews: Awaited<ReturnType<ManifestPreview["preview"]>>;
	policy: Pick<
		Parameters<typeof selectCandidates>[0],
		"subscription" | "target" | "profile" | "now"
	>;
	episode: number;
	assessTitle: ReleaseAssessmentApi["assessReleaseTitle"];
}) {
	const entries: ReleaseEvidence[] = [];
	const plans = new Map<
		string,
		{ plan: EpisodeFilePlan; attributes: ReleaseAttributes }
	>();
	for (const [offset, preview] of input.previews.entries()) {
		const source = input.inspection[offset];
		if (
			!source ||
			preview.code !== null ||
			!preview.manifest ||
			!preview.coverage ||
			preview.manifest.indexSource !== "client"
		)
			continue;
		const declaration = input.assessTitle(
			source.entry.title,
			input.policy.target,
		);
		if (!declaration.inspectionCandidate) continue;
		for (const video of preview.coverage.videos) {
			if (
				video.episodes.length !== 1 ||
				video.episodes[0] !== input.episode ||
				!preview.manifest.files[video.index]?.sizeBytes
			)
				continue;
			const attributes = versionAttributes(
				declaration.attributes,
				video.attributes,
			);
			if (!attributes) continue;
			const id = `${source.publication.snapshot.id}:${source.entry.id}:${video.index}`;
			entries.push({ ...source.entry, id });
			plans.set(id, {
				plan: {
					manifest: preview.manifest,
					videoIndex: video.index,
					subtitleIndices: video.subtitleIndices,
				},
				attributes,
			});
		}
	}
	const ranked = selectCandidates({
		...input.policy,
		feed: { entries },
		waitForLevels: false,
		active: new Set(),
		downloadsUnknown: false,
		assessReleaseTitle: (_title, _target, entry) => {
			const plan = plans.get(entry.id);
			return {
				...(plan ? { attributes: plan.attributes } : {}),
				eligible: true,
				inspectionCandidate: true,
				episode: input.episode,
				reasons: [],
				version: "manifest-single-v1",
			};
		},
	});
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const ordered = [
		...ranked.filter((candidate) => candidate.status === "selected"),
		...ranked.filter((candidate) => candidate.status === "skipped"),
	];
	return ordered.flatMap((candidate) => {
		const entry = byId.get(candidate.entryId);
		const plan = plans.get(candidate.entryId)?.plan;
		if (
			!entry?.download ||
			!plan ||
			candidate.reasons.some(
				(reason) =>
					reason !== "another_version_selected" &&
					reason !== "newer_revision_available",
			)
		)
			return [];
		return [{ candidate, source: entry.download, plan }];
	});
}
