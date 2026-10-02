import { useEffect, useState } from "react";
import { getSubtitles } from "../api/client.js";
import type { SubtitleDiscoveryResponse } from "../api/contracts.js";

/** Retry file recreates the player and refreshes this discovery. */
export function useExternalSubtitles(fileId: string) {
	const [discovery, setDiscovery] = useState<SubtitleDiscoveryResponse | null>(
		null,
	);
	useEffect(() => {
		const controller = new AbortController();
		setDiscovery(null);
		void getSubtitles(fileId, { signal: controller.signal })
			.then((result) => {
				if (!controller.signal.aborted) setDiscovery(result);
			})
			.catch(() => {});
		return () => controller.abort();
	}, [fileId]);
	return discovery;
}
