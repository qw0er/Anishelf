import type {
	ConnectionInput,
	ConnectionProbe,
	ConnectionSettings,
} from "./domain/model.js";

export interface QbittorrentConnectionApi {
	settings(): ConnectionSettings;
	save(input: ConnectionInput): Promise<ConnectionSettings>;
	clear(generation: string): Promise<ConnectionSettings>;
	probe(generation: string): Promise<ConnectionProbe>;
}
