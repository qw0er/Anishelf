import type { DownloadActivity, DownloadDestination } from "./domain/model.js";

export type { DownloadStore, TorrentTransport } from "./ports.js";
export interface DownloadsApi {
	settings(): Promise<{
		destination: DownloadDestination | null;
		roots: { scopeId: string; name: string }[];
	}>;
	saveDestination(input: {
		revision: string | null;
		scopeId: string;
		path: string;
	}): Promise<DownloadDestination>;
	validate(revision: string): Promise<DownloadDestination>;
	activity(workKey: string, page?: number): DownloadActivity;
	authorize(
		workKey: string,
		revision: string,
		destinationRevision: string,
	): Promise<void>;
	retry(
		id: string,
		revision: string,
		commandId: string,
		kind: "acquisition" | "import",
	): void;
}
