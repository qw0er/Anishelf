// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../src/api/client.js";
import type {
	CompatibilityInspection,
	CompatibilityResult,
	DirectoryResponse,
	FileDto,
} from "../src/api/contracts.js";
import { useDirectoryCompatibility } from "../src/features/library/hooks/use-directory-compatibility.js";
import { useMediaCompatibility } from "../src/features/playback/hooks/use-media-compatibility.js";
import * as capabilities from "../src/lib/media-capabilities.js";
import {
	clearOriginalCompatibilityCache,
	inspectBrowserMedia,
	originalCompatibilityKey,
} from "../src/lib/media-compatibility.js";
import { act, cleanup, renderHook, waitFor } from "./query-test-utils.js";

function file(id: string): FileDto {
	return {
		kind: "file",
		id,
		name: id,
		parentId: "root",
		sizeBytes: 100,
		modifiedAt: "today",
		mimeType: "video/mp4",
	};
}
function listing(ids: string[]): DirectoryResponse {
	return {
		directory: { kind: "directory", id: "root", name: "root", parentId: null },
		children: ids.map(file),
	};
}
const description = {
	sourceVersion: "version",
	descriptionId: "description",
	queries: [],
} as unknown as CompatibilityInspection;
beforeEach(() => {
	clearOriginalCompatibilityCache();
	vi.spyOn(api, "inspectMediaCompatibility").mockResolvedValue(description);
	vi.spyOn(capabilities, "queryCapabilities").mockResolvedValue([]);
	vi.spyOn(api, "checkMediaCompatibility").mockImplementation(
		async (input) =>
			({
				fileId: input.fileId,
				sourceVersion: "version",
				direct: { status: "supported", reason: "browser-supported" },
			}) as CompatibilityResult,
	);
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});
test("folder checks start asynchronously with bounded concurrency and navigation aborts old requests", async () => {
	const releases: Array<() => void> = [];
	vi.mocked(api.inspectMediaCompatibility).mockImplementation(
		(_input, _options) =>
			new Promise((resolve) => {
				releases.push(() => resolve(description));
			}),
	);
	const { result, rerender, unmount } = renderHook(
		({ data }) => useDirectoryCompatibility(data, "root-scope"),
		{ initialProps: { data: listing(["a", "b", "c", "d"]) } },
	);
	expect(result.current.get("d").loading).toBe(true);
	await waitFor(() =>
		expect(api.inspectMediaCompatibility).toHaveBeenCalledTimes(2),
	);
	await act(async () => {
		releases[0]?.();
	});
	await waitFor(() =>
		expect(api.inspectMediaCompatibility).toHaveBeenCalledTimes(3),
	);
	expect(result.current.get("a").result?.direct.status).toBe("supported");
	const oldSignal = vi.mocked(api.inspectMediaCompatibility).mock.calls[1]?.[1]
		?.signal;
	rerender({ data: listing(["new"]) });
	expect(oldSignal?.aborted).toBe(true);
	await act(async () => {
		releases[1]?.();
	});
	expect(result.current.get("new").loading).toBe(true);
	unmount();
	expect(
		vi.mocked(api.inspectMediaCompatibility).mock.calls.at(-1)?.[1]?.signal
			?.aborted,
	).toBe(true);
});
test("player reuses a completed folder check bound to metadata, scope and expected source version", async () => {
	const folder = renderHook(() =>
		useDirectoryCompatibility(listing(["a"]), "scope"),
	);
	await waitFor(() =>
		expect(folder.result.current.get("a").loading).toBe(false),
	);
	const player = renderHook(() =>
		useMediaCompatibility(
			"a",
			"version",
			originalCompatibilityKey(file("a"), "scope"),
		),
	);
	await waitFor(() => expect(player.result.current.loading).toBe(false));
	expect(api.inspectMediaCompatibility).toHaveBeenCalledTimes(1);
});
test("unknown results are distinct from request failures and a changed scope triggers new checks", async () => {
	vi.mocked(api.checkMediaCompatibility).mockResolvedValueOnce({
		sourceVersion: "version",
		direct: { status: "unknown", reason: "missing-evidence" },
	} as CompatibilityResult);
	const { result, rerender } = renderHook(
		({ scope }) => useDirectoryCompatibility(listing(["a"]), scope),
		{ initialProps: { scope: "root-1" } },
	);
	await waitFor(() => expect(result.current.get("a").loading).toBe(false));
	expect(result.current.get("a").result?.direct.status).toBe("unknown");
	vi.mocked(api.inspectMediaCompatibility).mockRejectedValueOnce(
		new Error("Unavailable"),
	);
	rerender({ scope: "root-2" });
	await waitFor(() =>
		expect(result.current.get("a").error).toBeInstanceOf(Error),
	);
	expect(result.current.get("a").result).toBeNull();
});

test("temporary inspection unavailability receives bounded retry before completing", async () => {
	vi.useFakeTimers();
	vi.mocked(api.inspectMediaCompatibility).mockRejectedValueOnce(
		new api.ApiClientError({
			kind: "http",
			status: 503,
			code: "MEDIA_INSPECTION_UNAVAILABLE",
			message: "Busy",
		}),
	);
	const pending = inspectBrowserMedia(
		{ fileId: "a" },
		new AbortController().signal,
	);
	await vi.advanceTimersByTimeAsync(500);
	await expect(pending).resolves.toBe(description);
	expect(api.inspectMediaCompatibility).toHaveBeenCalledTimes(2);
});

test("leaving a folder cancels an inspection retry delay without starting another request", async () => {
	vi.useFakeTimers();
	vi.mocked(api.inspectMediaCompatibility).mockRejectedValue(
		new api.ApiClientError({
			kind: "http",
			status: 503,
			code: "MEDIA_INSPECTION_UNAVAILABLE",
			message: "Busy",
		}),
	);
	const controller = new AbortController();
	const pending = inspectBrowserMedia({ fileId: "a" }, controller.signal);
	const rejected = expect(pending).rejects.toMatchObject({
		name: "AbortError",
	});
	await vi.advanceTimersByTimeAsync(0);
	controller.abort();
	await rejected;
	await vi.advanceTimersByTimeAsync(3000);
	expect(api.inspectMediaCompatibility).toHaveBeenCalledTimes(1);
});
