/** Provider-neutral transfer states. Unknown states must never authorize import. */
export type TorrentState =
	| "downloading"
	| "completed"
	| "seeding"
	| "paused"
	| "queued"
	| "stalled"
	| "checking"
	| "moving"
	| "metadata"
	| "error"
	| "missing"
	| "unknown";

export type TorrentFailureCode =
	| "unauthorized"
	| "unavailable"
	| "timeout"
	| "cancelled"
	| "rejected"
	| "invalid-response";

export class TorrentError extends Error {
	constructor(
		readonly code: TorrentFailureCode,
		readonly outcome: "read" | "not-sent" | "rejected" | "unknown",
	) {
		super(`Torrent client operation failed (${code}).`);
		this.name = "TorrentError";
	}
}

export interface TorrentTask {
	hash: string;
	v1Hash: string | null;
	v2Hash: string | null;
	name: string;
	state: TorrentState;
	progress: number;
	remainingBytes: number;
	totalBytes: number;
	downloadBytesPerSecond: number;
	uploadBytesPerSecond: number;
	savePath: string;
	contentPath: string;
	/** Durable intent identity, verified by the adapter; null for foreign/ambiguous tasks. */
	ownerKey: string | null;
}

export interface TorrentFile {
	index?: number;
	priority?: number;
	/** Untrusted downloader-relative path; callers must validate mapped access. */
	path: string;
	sizeBytes: number;
	progress: number;
	selected: boolean;
}

export type TorrentSource =
	| { magnet: string }
	| { torrent: Uint8Array<ArrayBuffer> };

interface TorrentManifestFile {
	readonly index: number;
	readonly path: string;
	readonly sizeBytes: number;
}

export interface TorrentManifest {
	readonly hash: string;
	/** A hybrid torrent uses the truncated v2 hash as its qBittorrent task ID. */
	readonly v2Hash?: string;
	/** Metainfo order still needs verification against the client's file indices. */
	readonly indexSource: "client" | "metainfo";
	readonly files: readonly TorrentManifestFile[];
}

export interface TorrentSubmission {
	source: TorrentSource;
	savePath: string;
	/** Adapter must persist this identity and return it through TorrentTask.ownerKey. */
	ownerKey: string;
	paused?: boolean;
	/** The matching manifest must have been staged on this connection. */
	fileSelection?: {
		hash: string;
		v2Hash?: string;
		priorities: readonly (0 | 1)[];
	};
}

export interface TorrentProbe {
	version: string;
	selectiveFiles?: true;
	/** Absolute staging directory, or null when isolation cannot be established. */
	incompleteDirectory: string | null;
}

export interface TorrentConnectionStatus {
	generation: string;
	state: "unconfigured" | "configured" | "unavailable";
}
export interface TorrentConnectionCheck {
	generation: string;
	available: boolean;
	checkedAt: number;
	version: string | null;
	code: string | null;
}
