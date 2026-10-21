export type {
	QbittorrentApi,
	QbittorrentOptions,
} from "./qbittorrent/public.js";
export { QbittorrentError } from "./qbittorrent/public.js";

import type { QbittorrentConnectionApi } from "./connection/public.js";
import type { DiscoveryApi } from "./discovery/public.js";
export interface AcquisitionApi {
	readonly connection: QbittorrentConnectionApi;
	readonly discovery: DiscoveryApi;
	readonly downloads?: import("./downloads/public.js").DownloadsApi;
}
