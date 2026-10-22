import type { Logger } from "pino";

export type QbittorrentFailureCode =
	| "unauthorized"
	| "unavailable"
	| "timeout"
	| "cancelled"
	| "rejected"
	| "invalid-response";

export class QbittorrentError extends Error {
	constructor(
		readonly code: QbittorrentFailureCode,
		readonly outcome: "read" | "not-sent" | "rejected" | "unknown",
	) {
		super(`qBittorrent operation failed (${code}).`);
		this.name = "QbittorrentError";
	}
}

export interface QbittorrentOptions {
	/** Server API base URL, independent from the browser WebUI setting. */
	url: string;
	username: string;
	password: string;
	logger: Logger;
	/** SDK timeout per HTTP request, not a deadline for the entire operation. */
	timeoutMs?: number;
}

export interface DownloadTask {
	hash: string;
	v1Hash: string | null;
	v2Hash: string | null;
	name: string;
	state: string;
	progress: number;
	remainingBytes: number;
	totalBytes: number;
	downloadBytesPerSecond: number;
	uploadBytesPerSecond: number;
	savePath: string;
	contentPath: string;
	category: string;
	tags: string[];
}

interface DownloadFile {
	/** Untrusted downloader-relative path; callers must validate mapped access. */
	path: string;
	sizeBytes: number;
	progress: number;
	priority: number;
}

export interface AddDownload {
	source: { magnet: string } | { torrent: Uint8Array<ArrayBuffer> };
	savePath: string;
	category: string;
	tags: string[];
	paused?: boolean;
}

/** Cancellation is checked between SDK calls; in-flight requests use the SDK timeout. */
export interface QbittorrentApi {
	probe(signal?: AbortSignal): Promise<{
		version: string;
		apiVersion: string;
		defaultSavePath: string;
		incompletePathEnabled: boolean;
		incompletePath: string;
	}>;
	/** Successful complete snapshot; errors never become an empty list. */
	tasks(signal?: AbortSignal): Promise<DownloadTask[]>;
	task(hash: string, signal?: AbortSignal): Promise<DownloadTask | null>;
	files(hash: string, signal?: AbortSignal): Promise<DownloadFile[]>;
	/** Acceptance only: callers must reconcile by canonical hash before binding. */
	add(input: AddDownload, signal?: AbortSignal): Promise<void>;
	/** Reject new operations and drain SDK requests before clearing authentication. */
	close(): Promise<void>;
}

export interface ConnectionInput {
	generation: string;
	url: string;
	username: string;
	password?: string;
}
export interface ConnectionSettings {
	generation: string;
	state: "unconfigured" | "configured" | "unavailable";
	url: string | null;
	username: string;
	passwordConfigured: boolean;
	bundled?: boolean;
}
export interface ConnectionProbe {
	generation: string;
	available: boolean;
	checkedAt: number;
	version: string | null;
	code: string | null;
}
export interface SavedConnection {
	version: 1;
	bundled?: boolean;
	generation: string;
	connection: { url: string; username: string; password: string } | null;
}
