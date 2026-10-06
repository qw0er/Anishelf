import type { CompatibilityCheckRequest } from "../../api/contracts.js";
import { boundedSignal } from "../../api/queries.js";
import { loadQuery } from "../../api/query-client.js";
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
	const description = await loadQuery(
		{
			queryKey: [
				"preparation-evidence",
				fileId,
				sourceVersion ?? null,
				profileId,
				audioStreamIndices ?? null,
			],
			staleTime: 0,
			queryFn: ({ signal }) =>
				inspectBrowserMedia(
					{
						fileId,
						output,
						...(sourceVersion ? { sourceVersion } : {}),
						...(audioStreamIndices !== undefined ? { audioStreamIndices } : {}),
					},
					boundedSignal(signal),
				),
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
