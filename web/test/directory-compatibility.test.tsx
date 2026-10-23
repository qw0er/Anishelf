import * as mediacompatibilityApi from "../src/features/media/media-compatibility/api.js";
import { ApiClientError } from "../src/shared/api/client.js";
import { queryClient } from "../src/shared/api/query-client.js";
// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as capabilities from "../src/features/media/media-compatibility/capabilities.js";
import { inspectBrowserMedia } from "../src/features/media/media-compatibility/compatibility.js";
import { useDirectoryCompatibility } from "../src/features/media/media-compatibility/use-directory-compatibility.js";
import type {
	CompatibilityInspection,
	CompatibilityResult,
	DirectoryResponse,
	FileDto,
} from "../src/shared/api/contracts.js";
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
	queryClient.removeQueries({ queryKey: ["compatibility"] });
	vi.spyOn(
		mediacompatibilityApi,
		"inspectMediaCompatibility",
	).mockResolvedValue(description);
	vi.spyOn(capabilities, "queryCapabilities").mockResolvedValue([]);
	vi.spyOn(mediacompatibilityApi, "checkMediaCompatibility").mockImplementation(
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
	vi.mocked(mediacompatibilityApi.inspectMediaCompatibility).mockImplementation(
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
		expect(
			mediacompatibilityApi.inspectMediaCompatibility,
		).toHaveBeenCalledTimes(2),
	);
	await act(async () => {
		releases[0]?.();
	});
	await waitFor(() =>
		expect(
			mediacompatibilityApi.inspectMediaCompatibility,
		).toHaveBeenCalledTimes(3),
	);
	expect(result.current.get("a").result?.direct.status).toBe("supported");
	const oldSignal = vi.mocked(mediacompatibilityApi.inspectMediaCompatibility)
		.mock.calls[1]?.[1]?.signal;
	rerender({ data: listing(["new"]) });
	expect(oldSignal?.aborted).toBe(true);
	await act(async () => {
		releases[1]?.();
	});
	expect(result.current.get("new").loading).toBe(true);
	unmount();
	expect(
		vi
			.mocked(mediacompatibilityApi.inspectMediaCompatibility)
			.mock.calls.at(-1)?.[1]?.signal?.aborted,
	).toBe(true);
});
test("folder navigation reuses completed checks in the same metadata and root scope", async () => {
	const first = renderHook(() =>
		useDirectoryCompatibility(listing(["a"]), "scope"),
	);
	await waitFor(() =>
		expect(first.result.current.get("a").loading).toBe(false),
	);
	first.unmount();
	const next = renderHook(() =>
		useDirectoryCompatibility(listing(["a"]), "scope"),
	);
	await waitFor(() => expect(next.result.current.get("a").loading).toBe(false));
	expect(mediacompatibilityApi.inspectMediaCompatibility).toHaveBeenCalledTimes(
		1,
	);
});
test("unknown results are distinct from request failures and retry triggers a new check", async () => {
	vi.mocked(
		mediacompatibilityApi.checkMediaCompatibility,
	).mockResolvedValueOnce({
		sourceVersion: "version",
		direct: { status: "unknown", reason: "missing-evidence" },
	} as CompatibilityResult);
	const { result } = renderHook(
		({ scope }) => useDirectoryCompatibility(listing(["a"]), scope),
		{ initialProps: { scope: "root-1" } },
	);
	await waitFor(() => expect(result.current.get("a").loading).toBe(false));
	expect(result.current.get("a").result?.direct.status).toBe("unknown");
	vi.mocked(
		mediacompatibilityApi.inspectMediaCompatibility,
	).mockRejectedValueOnce(new Error("Unavailable"));
	await act(async () => result.current.retry());
	await waitFor(() =>
		expect(result.current.get("a").error).toBeInstanceOf(Error),
	);
	expect(result.current.get("a").result?.direct.status).toBe("unknown");
});

test("temporary inspection unavailability receives bounded retry before completing", async () => {
	vi.useFakeTimers();
	vi.mocked(
		mediacompatibilityApi.inspectMediaCompatibility,
	).mockRejectedValueOnce(
		new ApiClientError({
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
	expect(mediacompatibilityApi.inspectMediaCompatibility).toHaveBeenCalledTimes(
		2,
	);
});

test("leaving a folder cancels an inspection retry delay without starting another request", async () => {
	vi.useFakeTimers();
	vi.mocked(mediacompatibilityApi.inspectMediaCompatibility).mockRejectedValue(
		new ApiClientError({
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
	expect(mediacompatibilityApi.inspectMediaCompatibility).toHaveBeenCalledTimes(
		1,
	);
});

test("reuses a persisted file-version result after Query eviction and bypasses it on manual recheck", async () => {
	const { clearCompatibilityCache } = await import(
		"../src/features/media/media-compatibility/cache.js"
	);
	await clearCompatibilityCache();
	const data = listing(["cached-file"]);
	const entry = data.children[0];
	if (entry?.kind !== "file") throw new Error("Missing file");
	entry.sourceVersion = "version";
	const first = renderHook(() => useDirectoryCompatibility(data, "revision-1"));
	await waitFor(() =>
		expect(first.result.current.get("cached-file").loading).toBe(false),
	);
	first.unmount();
	queryClient.removeQueries({ queryKey: ["compatibility"] });
	const reopened = renderHook(() =>
		useDirectoryCompatibility(data, "revision-2"),
	);
	await waitFor(() =>
		expect(reopened.result.current.get("cached-file").loading).toBe(false),
	);
	expect(mediacompatibilityApi.inspectMediaCompatibility).toHaveBeenCalledTimes(
		1,
	);
	await act(async () => reopened.result.current.retry());
	await waitFor(() =>
		expect(
			mediacompatibilityApi.inspectMediaCompatibility,
		).toHaveBeenCalledTimes(2),
	);
	await clearCompatibilityCache();
});
