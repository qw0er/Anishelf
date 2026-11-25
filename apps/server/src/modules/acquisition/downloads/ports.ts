import type { DownloadContent } from "../sources/public.js";
import type {
	TorrentClient,
	TorrentFile,
	TorrentTask,
} from "../torrent-clients/public.js";
import type {
	DownloadDestination,
	DownloadFileObservation,
	DownloadIntent,
	EpisodeFilePlan,
	ManagedFileSelection,
	PendingFileSelection,
	PlannedDownloadFile,
	VerifiedDownloadFiles,
} from "./domain/model.js";

export interface DownloadStore {
	transaction<T>(operation: () => T): T;
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
	attemptedCandidate(workKey: string, candidateId: string): boolean;
	reservedEpisode(workKey: string, episode: number): boolean;
	episodeIntent(workKey: string, episode: number): DownloadIntent | null;
	episodeCommand(commandId: string): DownloadIntent | null;
	saveEpisodeCommand(commandId: string, requestId: string): void;
	hashOwner(hash: string, generation: string, exceptId: string): boolean;
	workBatch(afterId: string, limit: number, now: number): DownloadIntent[];
	hasActive(): boolean;
	intent(id: string): DownloadIntent | null;
	reserve(value: DownloadIntent): boolean;
	ownedFileSelection(
		hash: string,
		generation: string,
	): ManagedFileSelection | null;
	fileSelection(id: string): ManagedFileSelection | null;
	episodeFileSelection(
		requestId: string,
		transferId: string,
	): {
		videoIndex: number;
		subtitleIndices: number[];
		files: PlannedDownloadFile[];
	} | null;
	planFileSelection(
		value: DownloadIntent,
		plan: EpisodeFilePlan,
		expectedRevision: string,
	): "planned" | "busy" | "incompatible";
	updateFileSelection(input: {
		transferId: string;
		revision: string;
		pending?: PendingFileSelection | null;
		observed?: readonly DownloadFileObservation[];
		task?: TorrentTask;
		observedAt?: number;
		fileProgress?: readonly { index: number; progress: number }[];
		cancel?: boolean;
		release?: boolean;
	}): boolean;
	saveIntent(value: DownloadIntent, files?: VerifiedDownloadFiles): boolean;
	prune(before: number, onPruned?: (item: DownloadIntent) => void): void;
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
		client: TorrentClient,
		snapshot: TorrentTask[],
		selection?: EpisodeFilePlan,
	): Promise<{ subscriptionRevision: string | null } | null>;
	/** Synchronous fence after the last remote read. */
	current?(item: DownloadIntent): boolean;
}
export interface CompletedDownload {
	task: TorrentTask;
	files: TorrentFile[];
	manifest?: {
		video: TorrentFile;
		sidecars: readonly TorrentFile[];
		isCurrent(): boolean;
	};
	verify(): Promise<boolean>;
}
