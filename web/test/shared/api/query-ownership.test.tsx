import { FileActions } from "../../../src/app/components/file-actions.js";
import * as mediacompatibilityApi from "../../../src/features/media/media-compatibility/api.js";
import * as preparationApi from "../../../src/features/media/preparation/api.js";
import * as settingsApi from "../../../src/features/settings/api.js";
// @vitest-environment happy-dom

import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { PreparationProvider } from "../../../src/features/media/preparation/context.js";
import { useFilePreparations } from "../../../src/features/media/preparation/use-file-preparations.js";
import { usePreparationAction } from "../../../src/features/media/preparation/use-preparations.js";
import { parseAudioSelection } from "../../../src/features/playback/player/playback-params.js";
import LibraryBrowser from "../../../src/features/resources/library/components/library-browser.js";
import type {
	CompatibilityInspection,
	CompatibilityResult,
	DirectoryResponse,
} from "../../../src/shared/api/contracts.js";
import {
	createQueryClient,
	loadQuery,
	queryClient,
} from "../../../src/shared/api/query-client.js";
import "../../../src/shared/i18n.js";
import {
	act,
	cleanup,
	render,
	renderHook,
	waitFor,
} from "../../support/query-test-utils.js";

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
		.spyOn(preparationApi, "getPreparationSummaries")
		.mockImplementation(async (ids) => ({
			files: ids.map((fileId) => ({ fileId, versions: [] })),
		}));
	const files = vi
		.spyOn(preparationApi, "getFilePreparations")
		.mockResolvedValue({ tasks: [] });
	vi.spyOn(preparationApi, "getPreparations").mockResolvedValue({ tasks: [] });
	vi.spyOn(settingsApi, "getTranscodeProfiles").mockResolvedValue({
		profiles: [],
		selectedProfileId: "builtin:web",
		selectionAvailable: true,
		preparationMode: "compatible" as const,
	});
	vi.spyOn(
		mediacompatibilityApi,
		"inspectMediaCompatibility",
	).mockResolvedValue({
		sourceVersion: "v",
		descriptionId: "d",
		queries: [],
	} as unknown as CompatibilityInspection);
	vi.spyOn(mediacompatibilityApi, "checkMediaCompatibility").mockResolvedValue({
		fileId: "f0",
		sourceVersion: "v",
		rulesVersion: "4",
		direct: { status: "supported", reason: "browser-supported" },
		container: { status: "supported", reason: "browser-supported" },
		video: { status: "supported", reason: "browser-supported" },
		audio: { status: "supported", reason: "browser-supported" },
		selectedVideo: null,
		defaultAudioStreamIndex: null,
		selectedAudioStreamIndices: [],
		audioTracks: [],
		output: null,
		warnings: [],
	} satisfies CompatibilityResult);
	render(
		<MemoryRouter>
			<PreparationProvider>
				<LibraryBrowser
					renderFileActions={(state) => <FileActions {...state} />}
					listing={listing}
					scan={{
						settings: { resourceRoots: ["/media"] },
						library: null,
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
		.spyOn(preparationApi, "getFilePreparations")
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
test("audio intent preserves automatic and one track, independently of retention arrays", () => {
	expect(parseAudioSelection(null)).toEqual({
		valid: true,
		index: undefined,
	});
	expect(parseAudioSelection("none")).toEqual({ valid: true, index: null });
	expect(parseAudioSelection("2")).toEqual({ valid: true, index: 2 });
	expect(parseAudioSelection("2,1").valid).toBe(false);
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
