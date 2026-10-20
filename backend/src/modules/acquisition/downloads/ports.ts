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
	intents(): DownloadIntent[];
	intent(id: string): DownloadIntent | null;
	reserve(value: DownloadIntent): boolean;
	saveIntent(value: DownloadIntent): void;
	prune(before: number): void;
}
export interface TorrentTransport {
	read(url: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
	close(): Promise<void>;
}
