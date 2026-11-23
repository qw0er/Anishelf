import type { SubtitleFormat } from "./subtitles.ts";

export const offlineCachePath = "/offline-cache";

export type OfflineCacheStatus =
	| "queued"
	| "preparing"
	| "downloading"
	| "finalizing"
	| "ready"
	| "failed"
	| "unavailable";

export type OfflineCacheFailure =
	| "interrupted"
	| "sourceChanged"
	| "unreachable"
	| "authentication"
	| "storage"
	| "space"
	| "missing"
	| "download";

export interface OfflineCacheEpisode {
	workId: string;
	workTitle: string;
	number: string;
	label: string;
}

export interface OfflineCacheEntry {
	id: string;
	server: string;
	fileId: string;
	sourceVersion: string | null;
	name: string;
	episodes: OfflineCacheEpisode[];
	status: OfflineCacheStatus;
	percent: number | null;
	sizeBytes: number;
	failure: OfflineCacheFailure | null;
	playing: boolean;
}

export interface OfflineCacheTarget {
	fileId: string;
	sourceVersion?: string;
	name?: string;
}

export interface OfflineCachePlayback {
	lease: string;
	name: string;
	url: string;
	format: string;
	positionMs: number;
	subtitles: {
		id: string;
		url: string;
		format: SubtitleFormat;
		label: string;
		language: string | null;
	}[];
}

export interface OfflineCacheHost {
	list(): Promise<OfflineCacheEntry[]>;
	subscribe(
		listener: (entry: OfflineCacheEntry | null, id: string) => void,
	): () => void;
	start(target: OfflineCacheTarget): Promise<void>;
	cancel(id: string): Promise<void>;
	retry(id: string): Promise<void>;
	remove(id: string): Promise<void>;
	open(id: string): Promise<OfflineCachePlayback | null>;
	savePosition(lease: string, positionMs: number): Promise<void>;
	close(lease: string): Promise<void>;
}
