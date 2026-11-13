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
	/** Untrusted downloader-relative path; callers must validate mapped access. */
	path: string;
	sizeBytes: number;
	progress: number;
	selected: boolean;
}

export interface TorrentSubmission {
	source: { magnet: string } | { torrent: Uint8Array<ArrayBuffer> };
	savePath: string;
	/** Adapter must persist this identity and return it through TorrentTask.ownerKey. */
	ownerKey: string;
	paused?: boolean;
}

export interface TorrentProbe {
	version: string;
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
