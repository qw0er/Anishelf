import type { CompatibilityCheckRequest } from "../../api/contracts.js";
import { queryCapabilities } from "../../lib/media-capabilities.js";
import { inspectBrowserMedia } from "../../lib/media-compatibility.js";

/** Retry and reuse always obtain fresh, source/profile-bound browser evidence. */
export async function negotiatePreparation(
	fileId: string,
	profileId: string,
	signal: AbortSignal,
	sourceVersion?: string,
	audioStreamIndices?: number[],
): Promise<CompatibilityCheckRequest> {
	const output = { profileId, target: "file" as const };
	const description = await inspectBrowserMedia(
		{
			fileId,
			output,
			...(sourceVersion ? { sourceVersion } : {}),
			...(audioStreamIndices !== undefined ? { audioStreamIndices } : {}),
		},
		signal,
	);
	const evidence = await queryCapabilities(description.queries, signal, true);
	return {
		sourceVersion: description.sourceVersion,
		descriptionId: description.descriptionId,
		...(audioStreamIndices !== undefined ? { audioStreamIndices } : {}),
		output,
		evidence,
	};
}
