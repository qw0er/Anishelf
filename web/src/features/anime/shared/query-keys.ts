import type { QueryClient } from "@tanstack/react-query";
export const animeLibraryQueryKey = ["anime-library"] as const;
export function invalidateAnimeQueries(
	client: QueryClient,
	change: "info" | "local" | "viewing" | "acquisition" = "local",
	workKey?: string,
): Promise<unknown[]> {
	const keys: readonly (readonly string[])[] =
		change === "acquisition"
			? [["anime-status"]]
			: change === "viewing"
				? [
						["anime-status"],
						animeLibraryQueryKey,
						["tracking", "entry"],
						["tracking", "operations"],
					]
				: [
						["anime-detail"],
						animeLibraryQueryKey,
						["catalog"],
						["metadata-detail"],
						["metadata-relations"],
						["metadata-airing"],
					];
	return Promise.all(
		keys.map((queryKey) =>
			client.invalidateQueries({
				queryKey,
				...(workKey && queryKey[0] === "anime-status"
					? { predicate: (query) => query.queryKey[2] === workKey }
					: {}),
			}),
		),
	);
}
