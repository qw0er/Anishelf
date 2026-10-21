import type {
	DownloadAuthorization,
	DownloadDestination,
	DownloadIntent,
} from "./domain/model.js";
export interface DownloadStore {
	destination(): DownloadDestination | null;
	saveDestination(value: DownloadDestination): void;
	authorization(workKey: string): DownloadAuthorization | null;
	authorize(value: DownloadAuthorization): void;
	directory(workKey: string): string | null;
	saveDirectory(workKey: string, directory: string): void;
	activity(
		workKey: string,
		page: number,
		pageSize: number,
	): {
		items: DownloadIntent[];
		total: number;
		active: number;
		attention: number;
		candidateIds: string[];
	};
	reservedEpisode(workKey: string, episode: number): boolean;
	hashOwner(hash: string, exceptId: string): boolean;
	workBatch(afterId: string, limit: number, now: number): DownloadIntent[];
	hasActive(): boolean;
	intent(id: string): DownloadIntent | null;
	reserve(value: DownloadIntent): boolean;
	saveIntent(value: DownloadIntent): void;
	prune(before: number): void;
}
export interface TorrentTransport {
	read(url: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
	close(): Promise<void>;
}

export interface SubmissionAdmission {
	authorize(
		execution: {
			current: DownloadIntent;
			save(value: DownloadIntent): DownloadIntent;
		},
		client: import("../qbittorrent/public.js").QbittorrentApi,
		snapshot: import("../qbittorrent/public.js").DownloadTask[],
	): Promise<string | null>;
}
export interface CompletedDownload {
	task: import("../qbittorrent/public.js").DownloadTask;
	files: Awaited<
		ReturnType<import("../qbittorrent/public.js").QbittorrentApi["files"]>
	>;
	verify(): Promise<boolean>;
}
