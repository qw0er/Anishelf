export type {
	DownloadTask,
	QbittorrentApi,
	QbittorrentOptions,
} from "./model.js";
export { QbittorrentError } from "./model.js";

import type {
	ConnectionInput,
	ConnectionProbe,
	ConnectionSettings,
} from "./model.js";

export interface QbittorrentConnectionApi {
	settings(): ConnectionSettings;
	credentials(generation: string): { username: string; password: string };
	save(input: ConnectionInput): Promise<ConnectionSettings>;
	clear(generation: string): Promise<ConnectionSettings>;
	probe(generation: string): Promise<ConnectionProbe>;
}
