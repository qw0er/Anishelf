import type { TorrentClient, TorrentConnectionStatus } from "./public.js";

/** Provider configuration supplies status and constructs an authenticated client. */
export interface TorrentConfiguration {
	settings(): TorrentConnectionStatus;
	createClient(): TorrentClient;
}
