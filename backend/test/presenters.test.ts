import { expect, test } from "vitest";
import type {
	DirectoryEntry,
	FileEntry,
} from "../src/modules/library/domain/model.js";
import type { ScanState } from "../src/modules/library/domain/scan-state.js";
import {
	continueWatchingResponse,
	directoryResponse,
	fileDto,
	libraryResponse,
	playbackProgressDto,
	playbackSessionResponse,
	scanStateDto,
	settingsResponse,
} from "../src/transport/presenters.js";

test("resource projections omit internal paths even when given full index entries", () => {
	const directory: DirectoryEntry = {
		kind: "directory",
		id: "root",
		parentId: null,
		name: "Library",
		relativePath: "private-directory",
	};
	const file: FileEntry = {
		kind: "file",
		id: "file_episode",
		parentId: "root",
		name: "Episode.mp4",
		relativePath: "private-directory/Episode.mp4",
		sizeBytes: 100,
		modifiedAt: "2026-10-01T00:00:00.000Z",
		mimeType: "video/mp4",
	};
	const response = directoryResponse({
		directory,
		children: [directory, file],
	});
	expect(response.directory).toEqual({
		kind: "directory",
		id: "root",
		parentId: null,
		name: "Library",
	});
	expect(response.children[1]).toEqual(fileDto(file));
	expect(fileDto(file)).not.toHaveProperty("relativePath");
	expect(JSON.stringify(response)).not.toContain("private-directory");
});

test("scan and status projections retain every state without sharing mutable warnings", () => {
	const fields = {
		id: "scan-1",
		startedAt: "2026-10-01T00:00:00.000Z",
		visitedCount: 3,
		matchedCount: 1,
		warnings: { count: 1, messages: ["A resource was skipped."] },
		internalPath: "private-directory",
	};
	const states: ScanState[] = [
		{ ...fields, status: "running", finishedAt: null },
		{ ...fields, status: "completed", finishedAt: fields.startedAt },
		{ ...fields, status: "cancelled", finishedAt: fields.startedAt },
		{
			...fields,
			status: "failed",
			finishedAt: fields.startedAt,
			error: { code: "SCAN_FAILED", message: "Scan failed." },
		},
	];
	for (const state of states) {
		const response = libraryResponse({
			ready: true,
			revision: 1,
			scan: state,
			error: state.status === "failed" ? state.error : null,
			stale: state.status === "failed",
		});
		expect(response.scan?.status).toBe(state.status);
		expect(response.scan?.finishedAt).toBe(state.finishedAt);
		expect(response.scan).not.toHaveProperty("internalPath");
		if (state.status === "failed") expect(response.error).toEqual(state.error);
	}
	const copy = scanStateDto(states[0] as ScanState);
	fields.warnings.messages.push("Later warning.");
	expect(copy.warnings.messages).toEqual(["A resource was skipped."]);
});

test("settings responses expose only the public setting for setup and configured roots", () => {
	for (const resourceRoot of [null, "/media"]) {
		const stored = { resourceRoot, internalPath: "private-settings" };
		expect(settingsResponse(stored)).toEqual({ resourceRoot });
	}
});

test("playback presenters omit storage identities and internal additions", () => {
	const file = {
		kind: "file" as const,
		id: "file_episode",
		parentId: "root",
		name: "Episode.mp4",
		sizeBytes: 100,
		modifiedAt: "2026-10-01T00:00:00.000Z",
		mimeType: "video/mp4",
		relativePath: "private/Episode.mp4",
	};
	const progress = {
		sourceId: "private-source-id",
		positionMs: 1000,
		durationMs: 100000,
		lastViewedAtMs: 1000,
		generation: 1,
		lastSequence: 1,
		canonicalPath: "/private/media",
	};
	const session = {
		token: "session-token",
		generation: 1,
		sourceVersion: "v1",
		file,
		plan: {
			mode: "direct" as const,
			playbackUrl: "/api/media/file_episode",
			internalPath: "private-copy",
		},
		progress,
		internalSession: "private-session",
	};
	const publicSession = playbackSessionResponse(session);
	expect(publicSession.progress).toEqual(playbackProgressDto(progress));
	const list = continueWatchingResponse({
		availability: "checked",
		items: [{ file, progress }],
	});
	for (const response of [publicSession, list]) {
		expect(JSON.stringify(response)).not.toContain("private");
	}
	expect(list.items[0]?.file).toEqual(fileDto(file));
});
