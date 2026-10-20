import type { Logger } from "pino";

export type QbittorrentFailureCode =
	| "invalid-input"
	| "unauthorized"
	| "unsupported-version"
	| "unavailable"
	| "timeout"
	| "cancelled"
	| "rejected"
	| "invalid-response"
	| "response-too-large"
	| "redirect";

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
	timeoutMs?: number;
	maximumResponseBytes?: number;
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
	index: number;
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
	pause(hash: string, signal?: AbortSignal): Promise<void>;
	resume(hash: string, signal?: AbortSignal): Promise<void>;
	recheck(hash: string, signal?: AbortSignal): Promise<void>;
	/** Always preserves downloaded data. Destructive deletion is future scope. */
	remove(hash: string, signal?: AbortSignal): Promise<void>;
	close(): Promise<void>;
}
