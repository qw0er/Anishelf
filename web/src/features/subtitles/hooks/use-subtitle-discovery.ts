import { useQuery } from "@tanstack/react-query";
import { getSubtitles } from "../../../api/client.js";
import { boundedSignal, keys, useQueryScope } from "../../../api/queries.js";
/** Structural sharing and a stable source key keep selected tracks across background updates. */
export function useSubtitleDiscovery(fileId: string) {
	const query = useQuery({
		queryKey: keys.subtitles(useQueryScope(), fileId),
		staleTime: Infinity,
		refetchOnMount: "always",
		queryFn: ({ signal }) =>
			getSubtitles(fileId, { signal: boundedSignal(signal) }),
	});
	return query.data ?? null;
}
