import type { SourcesApi } from "./sources/public.js";

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
	readonly sources: SourcesApi;
	readonly watching?: import("./watching/public.js").WatchingApi;
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
	summary(
		workKey: string,
	): Pick<DownloadActivity, "total" | "active" | "attention" | "planningError">;
	activity(workKey: string, page?: number): DownloadActivity;
	retry(
		id: string,
		revision: string,
		commandId: string,
		kind: "acquisition" | "import",
	): void;
}

/** HTTP activation requires a current target; source setup uses the unified Sources input. */
export type SubscriptionApi = Omit<SubscriptionsApi, "save"> & {
	save(
		input: Omit<SaveSubscriptionInput, "target"> & {
			destinationRevision: string;
			connectionGeneration: string;
		},
	): Promise<ReturnType<SubscriptionsApi["get"]>>;
};
