import { QbittorrentClient } from "./qbittorrent/client.js";
import type {
	QbittorrentApi,
	QbittorrentOptions,
} from "./qbittorrent/domain/model.js";

/** Standalone adapter foundation; no workers or automatic downloads are started. */
export function createQbittorrentClient(
	options: QbittorrentOptions,
): QbittorrentApi {
	return new QbittorrentClient(options);
}
