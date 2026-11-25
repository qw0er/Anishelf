import type { AcquisitionTarget } from "../../../anime/public.js";
import { selectWithCoverage } from "../../coverage-planning.js";
import type { ManifestPreviewCandidate } from "../../manifest-preview.js";
import type { selectCandidates } from "../../release-selection.js";
import type { SubscriptionsContext } from "./context.js";

export function shortlistPacks(
	context: SubscriptionsContext,
	publication: ManifestPreviewCandidate["publication"],
	target: AcquisitionTarget,
): ManifestPreviewCandidate[] {
	if (!context.options.manifestPreview || !publication.content) return [];
	return publication.snapshot.entries.flatMap((entry) => {
		if (!entry.download) return [];
		const assessment = context.options.anime.assessReleaseTitle(
			entry.title,
			target,
		);
		return assessment.inspectionCandidate && !assessment.eligible
			? [{ publication, entry }]
			: [];
	});
}

export async function previewCoverage(
	context: SubscriptionsContext,
	input: Pick<
		Parameters<typeof selectCandidates>[0],
		"subscription" | "target" | "downloadsUnknown"
	>,
	inspection: readonly ManifestPreviewCandidate[],
) {
	const { manifestPreview } = context.options;
	const { workKey, startEpisode } = input.subscription;
	if (!manifestPreview || !inspection.length || input.downloadsUnknown)
		return { supported: true, previews: [] };
	const supported = await manifestPreview.supportsSelection(context.signal);
	const previews = supported
		? await manifestPreview.preview({
				candidates: inspection,
				target: input.target,
				workKey,
				scope: { startEpisode },
				signal: context.signal,
			})
		: [];
	return { supported, previews };
}

export function evaluateCoverage(
	context: SubscriptionsContext,
	input: Parameters<typeof selectCandidates>[0],
	inspection: readonly ManifestPreviewCandidate[],
	{
		supported,
		previews,
	}: {
		supported: boolean;
		previews: readonly (
			| Awaited<ReturnType<typeof previewCoverage>>["previews"][number]
			| undefined
		)[];
	},
) {
	const { workKey } = input.subscription;
	const candidates = selectWithCoverage(
		input,
		inspection,
		previews,
		(hash) => context.options.reusableSelection?.(workKey, hash) ?? false,
	);
	const byEntry = new Map(
		candidates
			.filter((candidate) => !candidate.selection?.file)
			.map((candidate) => [candidate.entryId, candidate]),
	);
	const mapped = new Set(
		candidates
			.filter((candidate) => candidate.selection?.file)
			.map((candidate) => candidate.entryId),
	);
	for (const [offset, { entry }] of inspection.entries()) {
		const candidate = byEntry.get(entry.id);
		if (!candidate || mapped.has(entry.id)) continue;
		const reason =
			!supported || previews[offset]?.manifest?.indexSource === "metainfo"
				? "metadata_unsupported"
				: (previews[offset]?.code ??
					(previews[offset] ? "no_selectable_coverage" : "metadata_deferred"));
		candidate.reasons.push(reason);
	}
	return candidates.filter(
		(candidate) => candidate.selection?.file || !mapped.has(candidate.entryId),
	);
}

export async function inspectCoverage(
	context: SubscriptionsContext,
	input: Parameters<typeof selectCandidates>[0],
	inspection: readonly ManifestPreviewCandidate[],
) {
	return evaluateCoverage(
		context,
		input,
		inspection,
		await previewCoverage(context, input, inspection),
	);
}
