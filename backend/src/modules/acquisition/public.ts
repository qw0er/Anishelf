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
	readonly downloads?: import("./downloads/public.js").DownloadsApi;
}
