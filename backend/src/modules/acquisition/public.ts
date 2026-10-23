import type { SourceConnectionApi } from "./sources/public.js";

export type {
	QbittorrentApi,
	QbittorrentOptions,
} from "./qbittorrent/public.js";
export { QbittorrentError } from "./qbittorrent/public.js";

import type { QbittorrentConnectionApi } from "./qbittorrent/public.js";
import type {
	SaveSubscriptionInput,
	SubscriptionsApi,
} from "./subscriptions/public.js";
export interface AcquisitionApi {
	readonly sources: SourceConnectionApi;
	readonly connection: QbittorrentConnectionApi;
	readonly subscriptions: SubscriptionApi;
	readonly downloads?: AcquisitionDownloadsApi;
}

import type {
	DownloadActivity,
	DownloadDestination,
} from "./downloads/domain/model.js";
export interface AcquisitionDownloadsApi {
	settings(): Promise<{
		destination: DownloadDestination | null;
		roots: { scopeId: string; name: string }[];
	}>;
	saveDestination(input: {
		revision: string | null;
		scopeId: string;
		path: string;
	}): Promise<DownloadDestination>;
	validate(revision: string): Promise<DownloadDestination>;
	activity(workKey: string, page?: number): DownloadActivity;
	retry(
		id: string,
		revision: string,
		commandId: string,
		kind: "acquisition" | "import",
	): void;
}

/** HTTP activation supplies an explicit current destination/account stamp. */
export type SubscriptionApi = Omit<SubscriptionsApi, "save"> & {
	save(
		input: Omit<SaveSubscriptionInput, "source" | "target"> & {
			rssUrl: string;
			destinationRevision: string;
			connectionGeneration: string;
		},
	): Promise<ReturnType<SubscriptionsApi["get"]>>;
};
