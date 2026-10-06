// @vitest-environment happy-dom

import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import * as api from "../src/api/client.js";
import type {
	CompatibilityInspection,
	CompatibilityResult,
	DirectoryResponse,
} from "../src/api/contracts.js";
import {
	createQueryClient,
	loadQuery,
	queryClient,
} from "../src/api/query-client.js";
import LibraryBrowser from "../src/features/library/components/library-browser.js";
import { PreparationProvider } from "../src/features/preparation/context.js";
import { useFilePreparations } from "../src/features/preparation/use-file-preparations.js";
import { usePreparationAction } from "../src/features/preparation/use-preparations.js";
import { parseAudioSelection } from "../src/routes/playback-params.js";
import {
	act,
	cleanup,
	render,
	renderHook,
	waitFor,
} from "./query-test-utils.js";
import "../src/i18n.js";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

test("a directory uses one metadata batch and no file task/detail requests before menus open", async () => {
	const children = Array.from({ length: 12 }, (_, index) => ({
		kind: "file" as const,
		id: `f${index}`,
		name: `Episode ${index}.mp4`,
		parentId: "root",
		modifiedAt: "today",
		sizeBytes: 100,
		mimeType: "video/mp4",
	}));
	const listing: DirectoryResponse = {
		directory: { kind: "directory", id: "root", name: "Media", parentId: null },
		children,
	};
	const summaries = vi
		.spyOn(api, "getPreparationSummaries")
		.mockImplementation(async (ids) => ({
			files: ids.map((fileId) => ({ fileId, versions: [] })),
		}));
	const files = vi
		.spyOn(api, "getFilePreparations")
		.mockResolvedValue({ tasks: [] });
	vi.spyOn(api, "getPreparations").mockResolvedValue({ tasks: [] });
	vi.spyOn(api, "getTranscodeProfiles").mockResolvedValue({
		profiles: [],
		selectedProfileId: "builtin:web",
		selectionAvailable: true,
	});
	vi.spyOn(api, "inspectMediaCompatibility").mockResolvedValue({
		sourceVersion: "v",
		descriptionId: "d",
		queries: [],
	} as unknown as CompatibilityInspection);
	vi.spyOn(api, "checkMediaCompatibility").mockResolvedValue({
		sourceVersion: "v",
		direct: { status: "supported", reason: "browser-supported" },
	} as CompatibilityResult);
	render(
		<MemoryRouter>
			<PreparationProvider>
				<LibraryBrowser
					listing={listing}
					scan={{
						settings: { resourceRoot: "/media" },
						library: null,
						playerVersion: 0,
						libraryError: null,
						scanning: false,
						scanPending: false,
						scanSubmitting: false,
						refreshing: false,
						reload: vi.fn(),
						startScan: vi.fn(),
					}}
				/>
			</PreparationProvider>
		</MemoryRouter>,
	);
	await waitFor(() => expect(summaries).toHaveBeenCalledTimes(1));
	expect(summaries.mock.calls[0]?.[0]).toEqual(children.map((file) => file.id));
	expect(files).not.toHaveBeenCalled();
});

test("duplicate file observers share one request and preparation mutations invalidate their owner", async () => {
	const files = vi
		.spyOn(api, "getFilePreparations")
		.mockResolvedValue({ tasks: [] });
	const first = renderHook(() => useFilePreparations("file"));
	renderHook(() => useFilePreparations("file"));
	await waitFor(() => expect(first.result.current.loading).toBe(false));
	expect(files).toHaveBeenCalledTimes(1);
	const action = renderHook(() => usePreparationAction());
	const command = vi.fn(async () => {});
	await act(() => action.result.current.run(command));
	await waitFor(() => expect(files).toHaveBeenCalledTimes(2));
	expect(command).toHaveBeenCalledTimes(1);
});

test("aborting one preload stops its wait and preserves a second consumer's shared request", async () => {
	const client = createQueryClient();
	const firstController = new AbortController();
	const secondController = new AbortController();
	let resolve: (value: string) => void = () => {};
	let requestSignal: AbortSignal | undefined;
	const options = {
		queryKey: ["shared"],
		queryFn: ({ signal }: { signal: AbortSignal }) => {
			requestSignal = signal;
			return new Promise<string>((done) => {
				resolve = done;
			});
		},
	};
	const first = loadQuery(options, firstController.signal, client);
	const second = loadQuery(options, secondController.signal, client);
	const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
	firstController.abort();
	await rejected;
	expect(requestSignal?.aborted).toBe(false);
	resolve("shared result");
	await expect(second).resolves.toBe("shared result");
	client.clear();
});

test.each(["1,1", "-1", "1.5", "NaN", "1,", " 1", "9007199254740992"])(
	"rejects malformed audio intent %s",
	(value) => {
		expect(parseAudioSelection(value).valid).toBe(false);
	},
);
test("audio intent preserves default, silent and ordered explicit selections", () => {
	expect(parseAudioSelection(null)).toEqual({
		valid: true,
		indices: undefined,
	});
	expect(parseAudioSelection("")).toEqual({ valid: true, indices: [] });
	expect(parseAudioSelection("2,1")).toEqual({ valid: true, indices: [2, 1] });
	expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
});

test("the last departing preload cancels an unobserved shared request", async () => {
	const client = createQueryClient();
	const first = new AbortController();
	const second = new AbortController();
	let requestSignal: AbortSignal | undefined;
	const options = {
		queryKey: ["departed"],
		queryFn: ({ signal }: { signal: AbortSignal }) => {
			requestSignal = signal;
			return new Promise<string>(() => {});
		},
	};
	const reads = [
		loadQuery(options, first.signal, client),
		loadQuery(options, second.signal, client),
	];
	first.abort();
	second.abort();
	const results = await Promise.allSettled(reads);
	expect(results.every((result) => result.status === "rejected")).toBe(true);
	expect(requestSignal?.aborted).toBe(true);
	client.clear();
});
