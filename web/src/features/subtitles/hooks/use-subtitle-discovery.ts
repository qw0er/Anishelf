import { useQuery } from "@tanstack/react-query";
import { boundedSignal, useQueryScope } from "../../../shared/api/queries.js";
import { getSubtitles } from "../api.js";
import { subtitlesKeys } from "../queries.js";
/** Structural sharing and a stable source key keep selected tracks across background updates. */
export function useSubtitleDiscovery(fileId: string) {
	const query = useQuery({
		queryKey: subtitlesKeys.subtitles(useQueryScope(), fileId),
		staleTime: Infinity,
		refetchOnMount: "always",
		queryFn: ({ signal }) =>
			getSubtitles(fileId, { signal: boundedSignal(signal) }),
	});
	return query.data ?? null;
}
