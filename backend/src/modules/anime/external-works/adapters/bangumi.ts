import type { Logger } from "pino";
import { BangumiClient } from "../bangumi/public.js";
import { BangumiProvider } from "../metadata/infrastructure/bangumi.js";
import {
	BangumiTrackingProvider,
	bangumiTracking,
} from "../tracking/infrastructure/bangumi-provider.js";

export function createBangumiSources(logger: Logger) {
	const client = new BangumiClient({ logger });
	const tracking = new BangumiTrackingProvider(client);
	return {
		provider: new BangumiProvider(client),
		tracking: {
			descriptor: bangumiTracking,
			accountProvider: tracking,
			listProvider: tracking,
			updateProvider: tracking,
		},
		supportsMovie: (mediaId: string) =>
			tracking.supportsMovie(mediaId, AbortSignal.timeout(8000)),
		close: () => client.close(),
	};
}
