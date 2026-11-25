import type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
	ReleaseAttributes,
} from "../anime/public.js";
import type {
	ManifestPreview,
	ManifestPreviewCandidate,
} from "./manifest-preview.js";

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

export function manifestVersions(input: {
	inspection: readonly ManifestPreviewCandidate[];
	previews: readonly (
		| Awaited<ReturnType<ManifestPreview["preview"]>>[number]
		| undefined
	)[];
	target: AcquisitionTarget;
	assessTitle(
		title: string,
		target: AcquisitionTarget,
		entry: ManifestPreviewCandidate["entry"],
	): ReturnType<ReleaseAssessmentApi["assessReleaseTitle"]>;
}) {
	return input.previews.flatMap((preview, offset) => {
		const source = input.inspection[offset];
		const { manifest, coverage } = preview ?? {};
		if (!source || !manifest || !coverage || manifest.indexSource !== "client")
			return [];
		const declaration = input.assessTitle(
			source.entry.title,
			input.target,
			source.entry,
		);
		if (!declaration.inspectionCandidate) return [];
		const files = new Map(manifest.files.map((file) => [file.index, file]));
		return coverage.videos.flatMap((video) => {
			const file = files.get(video.index);
			const attributes = versionAttributes(
				declaration.attributes,
				video.attributes,
			);
			if (!file?.sizeBytes || !attributes || !video.episodes.length) return [];
			const subtitleIndices = [...video.subtitleIndices].sort((a, b) => a - b);
			return [
				{
					source,
					manifest,
					coverage,
					video,
					attributes,
					subtitleIndices,
					path: file.path,
					sizeBytes:
						file.sizeBytes +
						subtitleIndices.reduce(
							(total, index) => total + (files.get(index)?.sizeBytes ?? 0),
							0,
						),
				},
			];
		});
	});
}
