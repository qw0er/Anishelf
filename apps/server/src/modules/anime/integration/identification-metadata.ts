import { workCandidate } from "@anishelf/anime-identification";
import type { IdentificationMetadata } from "../identification/public.js";
export function createIdentificationMetadata(
	metadata: Pick<
		import("../external-works/metadata/public.js").MetadataApi,
		"search"
	>,
): IdentificationMetadata {
	return {
		search: async (query, signal, options) => {
			const result = await metadata.search(
				{ query },
				{ signal, refresh: options?.refresh ?? false },
			);
			return result.data.items.map((work) =>
				workCandidate(work, result.snapshotId),
			);
		},
	};
}
