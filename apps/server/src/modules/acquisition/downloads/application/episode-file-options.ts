import type {
	ReleaseAssessmentApi,
	ReleaseAttributes,
} from "../../../anime/public.js";
import { unlockedCandidate } from "../../coverage-planning.js";
import type {
	ManifestPreview,
	ManifestPreviewCandidate,
} from "../../manifest-preview.js";
import { manifestVersions } from "../../manifest-versions.js";
import { selectCandidates } from "../../release-selection.js";
import type { ReleaseEvidence } from "../../sources/public.js";
import type { EpisodeFilePlan } from "../domain/model.js";

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
		{ plan: EpisodeFilePlan; attributes: ReleaseAttributes; sizeBytes: number }
	>();
	for (const version of manifestVersions({
		...input,
		target: input.policy.target,
	})) {
		const { source, manifest, video, subtitleIndices, attributes, sizeBytes } =
			version;
		if (video.episodes.length !== 1 || video.episodes[0] !== input.episode)
			continue;
		const id = `${source.publication.snapshot.id}:${source.entry.id}:${video.index}`;
		entries.push({ ...source.entry, id });
		plans.set(id, {
			plan: { manifest, videoIndex: video.index, subtitleIndices },
			attributes,
			sizeBytes,
		});
	}
	const ranked = selectCandidates({
		...input.policy,
		feed: { entries },
		waitForLevels: false,
		recordLevelIndex: true,
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
	return ranked
		.flatMap((candidate) => {
			const entry = byId.get(candidate.entryId);
			const version = plans.get(candidate.entryId);
			if (!entry?.download || !version || !unlockedCandidate(candidate))
				return [];
			return [
				{
					candidate,
					source: entry.download,
					plan: version.plan,
					sizeBytes: version.sizeBytes,
				},
			];
		})
		.sort(
			(a, b) =>
				(a.candidate.selection?.levelIndex ?? Infinity) -
					(b.candidate.selection?.levelIndex ?? Infinity) ||
				a.plan.subtitleIndices.length - b.plan.subtitleIndices.length ||
				a.sizeBytes - b.sizeBytes ||
				Number(a.candidate.reasons.includes("newer_revision_available")) -
					Number(b.candidate.reasons.includes("newer_revision_available")),
		);
}
