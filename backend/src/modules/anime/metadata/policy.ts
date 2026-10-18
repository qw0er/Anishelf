export const metadataPolicy = {
	projectionVersion: "metadata-v1",
	searchFreshMs: 24 * 60 * 60 * 1000,
	emptySearchFreshMs: 15 * 60 * 1000,
	detailFreshMs: 24 * 60 * 60 * 1000,
	releasingFreshMs: 6 * 60 * 60 * 1000,
	finishedFreshMs: 7 * 24 * 60 * 60 * 1000,
	airingFreshMs: 15 * 60 * 1000,
	searchKeys: 1000,
	snapshots: 2000,
	maximumPending: 100,
	requestTimeoutMs: 8000,
	responseMaximumBytes: 2 * 1024 * 1024,
	artworkMaximumBytes: 5 * 1024 * 1024,
	artworkBudgetBytes: 128 * 1024 * 1024,
} as const;

export function detailFreshnessMs(status: string | null): number {
	if (status === "RELEASING") return metadataPolicy.releasingFreshMs;
	if (status === "FINISHED") return metadataPolicy.finishedFreshMs;
	return metadataPolicy.detailFreshMs;
}
