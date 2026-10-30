import { vi } from "vitest";
import type {
	AnimeLibraryResponse,
	DirectoryResponse,
	FileResponse,
	LibraryResponse,
	PreparationTaskResponse,
	ScanStateDto,
	SettingsResponse,
} from "../../../src/shared/api/contracts.js";
import { trackingProvider } from "../../support/tracking-fixture.js";

export const appFixture = {} as {
	library: LibraryResponse;
	directories: Map<string, DirectoryResponse>;
	fileError: boolean;
	compatibilityStatus: "supported" | "unsupported" | "unknown";
	inspectionAvailable: boolean;
	settings: SettingsResponse;
	preparationTasks: PreparationTaskResponse[];
};

export const runningScan: ScanStateDto = {
	id: "scan-1",
	status: "running",
	startedAt: "2026-09-29T00:00:00.000Z",
	finishedAt: null,
	visitedCount: 2,
	matchedCount: 1,
	warnings: { count: 0, messages: [] },
};

export const completedScan: ScanStateDto = {
	...runningScan,
	status: "completed",
	finishedAt: "2026-09-29T00:00:01.000Z",
};

export const file: FileResponse = {
	file: {
		kind: "file",
		id: "file-1",
		parentId: "season-1",
		name: "Episode 01.mp4",
		sizeBytes: 100,
		modifiedAt: "2026-09-29T00:00:00.000Z",
		mimeType: "video/mp4",
	},
	originalMediaUrl: "/api/media/file-1",
};

export const disconnectedList: AnimeLibraryResponse["tracking"] = {
	provider: trackingProvider,
	accountId: null,
	generation: "fixture",
	state: "disconnected",
	fetchedAt: null,
	stale: true,
	refreshing: false,
	error: null,
};

export const fetcher = vi.fn<typeof fetch>();

export function json(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export function requiredFetch(
	value: ReturnType<typeof fetcher.getMockImplementation>,
) {
	if (!value) throw new Error("Missing fetch mock");
	return value;
}
