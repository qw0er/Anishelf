import type {
	Candidate,
	FeedEntry,
	Subscription,
} from "../discovery/public.js";
import type {
	DownloadAuthorization,
	DownloadDestination,
	DownloadIntent,
} from "./domain/model.js";

/** Consumer-owned reads and an explicit result notification; no Discovery persistence access. */
export interface DownloadSelection {
	subscription(workKey: string): Subscription | null;
	subscriptions(): Subscription[];
	candidates(workKey: string): Candidate[];
	release(
		feedId: string,
		entryId: string,
	): Pick<FeedEntry, "downloadUrl" | "hash"> | null;
	reservationOutcome(subscription: Subscription, failed: boolean): void;
}
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
