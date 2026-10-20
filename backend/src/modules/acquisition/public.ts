export type {
	QbittorrentApi,
	QbittorrentOptions,
} from "./qbittorrent/public.js";
export { QbittorrentError } from "./qbittorrent/public.js";

import type { QbittorrentConnectionApi } from "./connection/public.js";
export interface AcquisitionApi {
	readonly connection: QbittorrentConnectionApi;
}
