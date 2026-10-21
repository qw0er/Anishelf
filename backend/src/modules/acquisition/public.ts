export type {
	QbittorrentApi,
	QbittorrentOptions,
} from "./qbittorrent/public.js";
export { QbittorrentError } from "./qbittorrent/public.js";

import type { DiscoveryApi } from "./discovery/public.js";
import type { QbittorrentConnectionApi } from "./qbittorrent/public.js";
export interface AcquisitionApi {
	readonly connection: QbittorrentConnectionApi;
	readonly discovery: DiscoveryApi;
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
