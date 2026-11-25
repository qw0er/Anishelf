import type {
	TorrentFile,
	TorrentManifest,
	TorrentProbe,
	TorrentSource,
	TorrentSubmission,
	TorrentTask,
} from "./domain/model.js";
import type { QbittorrentConnectionApi } from "./qbittorrent/public.js";

export type {
	TorrentConnectionCheck,
	TorrentConnectionStatus,
	TorrentFailureCode,
	TorrentFile,
	TorrentManifest,
	TorrentProbe,
	TorrentSource,
	TorrentState,
	TorrentSubmission,
	TorrentTask,
} from "./domain/model.js";
export { TorrentError } from "./domain/model.js";
export type { QbittorrentOptions } from "./qbittorrent/public.js";

/** TorrentClients owns this contract; adapters translate provider protocols and errors. */
export interface TorrentClient {
	probe(signal?: AbortSignal): Promise<TorrentProbe>;
	/** Successful complete snapshot; failures must never become an empty list. */
	tasks(signal?: AbortSignal): Promise<TorrentTask[]>;
	/** Lookup accepts canonical v1/v2 hashes and returns null only on confirmed absence. */
	task(hash: string, signal?: AbortSignal): Promise<TorrentTask | null>;
	files(hash: string, signal?: AbortSignal): Promise<TorrentFile[]>;
	/** Read-only preview. Null means the client lacks the required API capability. */
	inspectMetadata?(
		input: { source: TorrentSource; expectedHash: string },
		signal?: AbortSignal,
	): Promise<TorrentManifest | null>;
	/** Acceptance only. Throws TorrentError; unknown outcomes must be reconciled before retry. */
	add(input: TorrentSubmission, signal?: AbortSignal): Promise<void>;
	enableFiles?(
		hash: string,
		indices: readonly number[],
		signal?: AbortSignal,
	): Promise<void>;
	/** Reject new operations and drain outstanding requests before releasing credentials. */
	close(): Promise<void>;
}

/** Generation fences prevent tasks from silently moving to another downloader/account. */
export interface TorrentConnection {
	connectionGeneration(): string;
	withClient<T>(
		generation: string,
		operation: (client: TorrentClient) => Promise<T>,
	): Promise<T>;
}

/** One active client; transfer consumers do not inspect provider configuration. */
export interface TorrentClientsApi extends TorrentConnection {
	activeHashes(signal: AbortSignal): Promise<string[] | null>;
	readonly connection: QbittorrentConnectionApi;
}
