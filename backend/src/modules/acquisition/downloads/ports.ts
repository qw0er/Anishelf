import type { DownloadContent } from "../sources/public.js";
import type { DownloadDestination, DownloadIntent } from "./domain/model.js";
export interface DownloadStore {
	destination(): DownloadDestination | null;
	saveDestination(value: DownloadDestination): void;
	directory(workKey: string): string | null;
	saveDirectory(workKey: string, directory: string): void;
	summary(workKey: string): {
		total: number;
		active: number;
		attention: number;
	};
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
	lockedCandidates(workKey: string): string[];
	reservedEpisode(workKey: string, episode: number): boolean;
	hashOwner(hash: string, exceptId: string): boolean;
	workBatch(afterId: string, limit: number, now: number): DownloadIntent[];
	hasActive(): boolean;
	intent(id: string): DownloadIntent | null;
	reserve(value: DownloadIntent): boolean;
	saveIntent(value: DownloadIntent): void;
	prune(before: number): void;
}
export interface TorrentReader {
	read(reference: string, signal: AbortSignal): Promise<DownloadContent>;
	isCurrent(reference: string): boolean;
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
