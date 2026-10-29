import type { TorrentConnectionCheck } from "../domain/model.js";

export type { QbittorrentOptions } from "./model.js";

import type { ConnectionInput, ConnectionSettings } from "./model.js";

export interface QbittorrentConnectionApi {
	settings(): ConnectionSettings;
	credentials(generation: string): { username: string; password: string };
	save(input: ConnectionInput): Promise<ConnectionSettings>;
	activateBundled(generation: string): Promise<ConnectionSettings>;
	bundledAvailable(): Promise<boolean>;
	clear(generation: string): Promise<ConnectionSettings>;
	probe(generation: string): Promise<TorrentConnectionCheck>;
}
