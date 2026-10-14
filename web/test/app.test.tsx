import { queryClient } from "../src/shared/api/query-client.js";
import { animeFixture, reviewFixture } from "./fixtures/anime.js";
// @vitest-environment happy-dom

import { StrictMode } from "react";
import { createMemoryRouter, useLocation, useNavigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../src/app/App.js";
import { libraryRoute } from "../src/app/routes/library.js";
import type {
	CatalogSourceResponse,
	DirectoryResponse,
	FileResponse,
	LibraryResponse,
	PlaybackSessionResponse,
	PreparationTaskResponse,
	ScanStateDto,
	SettingsResponse,
} from "../src/shared/api/contracts.js";
import { Toaster, toast } from "../src/shared/components/ui/toast.js";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "./query-test-utils.js";

const runningScan: ScanStateDto = {
	id: "scan-1",
	status: "running",
	startedAt: "2026-09-29T00:00:00.000Z",
	finishedAt: null,
	visitedCount: 2,
	matchedCount: 1,
	warnings: { count: 0, messages: [] },
};
const completedScan: ScanStateDto = {
	...runningScan,
	status: "completed",
	finishedAt: "2026-09-29T00:00:01.000Z",
};
const file: FileResponse = {
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

const fetcher = vi.fn<typeof fetch>();
const routers: ReturnType<typeof createMemoryRouter>[] = [];
let library: LibraryResponse;
let directories: Map<string, DirectoryResponse>;
let fileError: boolean;
let compatibilityStatus: "supported" | "unsupported" | "unknown";
let settings: SettingsResponse;
let preparationTasks: PreparationTaskResponse[];

function json(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

beforeEach(() => {
	queryClient.removeQueries({ queryKey: ["compatibility"] });
	preparationTasks = [];
	library = {
		ready: true,
		revision: 1,
		scan: completedScan,
		error: null,
		stale: false,
	};
	directories = new Map([
		[
			"root",
			{
				directory: {
					kind: "directory",
					id: "root",
					parentId: null,
					name: "media",
				},
				children: [
					{
						kind: "directory",
						id: "season-1",
						parentId: "root",
						name: "Season 1",
					},
				],
			},
		],
		[
			"season-1",
			{
				directory: {
					kind: "directory",
					id: "season-1",
					parentId: "root",
					name: "Season 1",
				},
				children: [file.file],
			},
		],
	]);
	fileError = false;
	compatibilityStatus = "supported";
	settings = { resourceRoot: "/media" };
	fetcher.mockReset();
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path.startsWith("/api/files/file-1/chapters?"))
			return json({ sourceVersion: "version", chapters: [] });
		if (
			path === "/api/preparations?summary=true" ||
			path.startsWith("/api/preparations?")
		)
			return json({ tasks: preparationTasks });
		if (path === "/api/anime/identification")
			return json({ running: false, failed: false });
		if (path === "/api/catalog/sources/file-1")
			return json({ sourceVersion: "version", associations: [] });
		if (path.startsWith("/api/catalog/works?"))
			return json({ items: [], page: 1, perPage: 24, hasNextPage: false });
		if (path === "/api/transcode-profiles")
			return json({
				profiles: [
					{
						id: "builtin:web",
						name: "Browser",
						description: "Browser profile",
						container: "mp4",
						videoEncoder: "libx264",
						audioEncoder: "aac",
						source: "builtin",
						usage: "preparation",
					},
				],
				selectedProfileId: "builtin:web",
				selectionAvailable: true,
				preparationMode: "compatible" as const,
			});
		if (path === "/api/preparations/summaries")
			return json({
				files: [
					{
						fileId: "file-1",
						versions: preparationTasks
							.filter((task) => task.status === "ready" && task.artifactId)
							.map((task) => ({
								sourceVersion: task.sourceVersion,
								publishedCopies: 1,
								pendingTasks: 0,
							})),
					},
				],
			});
		if (path.startsWith("/api/preparations/"))
			return json(preparationTasks.find((task) => path.endsWith(task.id)));
		if (path.startsWith("/api/files/file-1/compatibility")) {
			if (init?.method === "POST") {
				const decision = {
					status: compatibilityStatus,
					reason:
						compatibilityStatus === "supported"
							? "browser-supported"
							: "browser-rejected",
				};
				return json({
					fileId: "file-1",
					sourceVersion: "version",
					rulesVersion: "4",
					direct: decision,
					container: decision,
					video: decision,
					audio: decision,
					selectedVideo: null,
					defaultAudioStreamIndex: null,
					selectedAudioStreamIndices: [],
					audioTracks: [],
					output: JSON.parse(String(init.body)).output
						? { combinations: { "copy-copy": "supported" } }
						: null,
					warnings: [],
				});
			}
			return json({
				fileId: "file-1",
				sourceVersion: "version",
				rulesVersion: "4",
				container: "mp4",
				descriptionId: "a".repeat(64),
				output: null,
				video: null,
				defaultAudioStreamIndex: null,
				selectedAudioStreamIndices: [],
				audioTracks: [],
				multipleTracks: false,
				queries: [],
			});
		}
		if (path === "/api/playback/options")
			return json({
				original: {
					sourceVersion: "version",
					descriptionId: "a".repeat(64),
					selectedAudioStreamIndices: [],
					queries: [],
					output: null,
				},
				candidates: [],
			});
		if (path === "/api/playback/selection") {
			const intent = JSON.parse(String(init?.body));
			const decision = {
				status: compatibilityStatus,
				reason:
					compatibilityStatus === "supported"
						? "browser-supported"
						: "browser-rejected",
			};
			const ready = preparationTasks.find(
				(task) => task.status === "ready" && task.resource,
			);
			const resource = {
				delivery: "file",
				url: file.originalMediaUrl,
				mimeType: "video/mp4",
				timeline: {
					sourceOriginMs: 0,
					mediaOriginMs: 0,
					sourceDurationMs: null,
				},
			};
			return json({
				sourceVersion: "version",
				pending: false,
				compatibility: {
					fileId: "file-1",
					sourceVersion: "version",
					rulesVersion: "4",
					direct: decision,
					container: decision,
					video: decision,
					audio: decision,
					selectedVideo: null,
					defaultAudioStreamIndex: null,
					selectedAudioStreamIndices: [],
					audioTracks: [],
					output: null,
					warnings: [],
				},
				plan: intent.tryOriginal
					? { mode: "direct", resource }
					: ready
						? {
								mode: "prepared",
								artifactId: ready.artifactId,
								resource: ready.resource,
							}
						: compatibilityStatus === "supported" &&
								!intent.failedResourceIds?.includes("file-1")
							? { mode: "direct", resource }
							: { mode: "blocked", reason: "browser-rejected" },
			});
		}

		if (path === "/api/playback/sessions") {
			return json(
				{
					token: "session-token",
					sourceVersion: "version",
					file: file.file,
					progress: {
						positionMs: 0,
						durationMs: 100000,
						lastViewedAtMs: null,
						generation: 1,
						lastSequence: 0,
					},
				} satisfies PlaybackSessionResponse,
				201,
			);
		}
		if (path === "/api/playback/sessions/session-token/progress") {
			const input = JSON.parse(String(init?.body));
			return json({
				status: "saved",
				progress: {
					positionMs: input.positionMs,
					durationMs: input.durationMs,
					generation: input.generation,
					lastSequence: input.sequence,
					lastViewedAtMs: 1,
				},
			});
		}
		if (
			path === "/api/playback/sessions/session-token" &&
			init?.method === "DELETE"
		)
			return new Response(null, { status: 204 });
		if (path === "/api/settings") {
			if (init?.method === "PUT") {
				const previousRoot = settings.resourceRoot;
				settings = JSON.parse(String(init.body)) as SettingsResponse;
				library = {
					...library,
					ready: true,
					scan:
						settings.resourceRoot !== previousRoot ? runningScan : library.scan,
					error: null,
					stale: false,
					revision: library.revision + 1,
				};
				const root = directories.get("root");
				if (root) directories.set("root", { ...root, children: [] });
			}
			return json(settings);
		}
		if (path === "/api/library") return json(library);
		if (path === "/api/library/scan") {
			library = { ...library, scan: runningScan };
			return json({ scan: runningScan }, 202);
		}
		if (path.startsWith("/api/directories/")) {
			const directory = directories.get(path.slice("/api/directories/".length));
			if (directory) return json(directory);
			return json(
				{
					error: {
						code: "RESOURCE_NOT_FOUND",
						message: "The resource was not found.",
						requestId: "id",
					},
				},
				404,
			);
		}
		if (path === "/api/files/file-1") {
			return fileError
				? json(
						{
							error: {
								code: "RESOURCE_MISSING",
								message:
									"This file is no longer available. Scan the library again.",
								requestId: "id",
							},
						},
						404,
					)
				: json(file);
		}
		throw new Error(`Unexpected URL: ${path}`);
	});
	vi.stubGlobal("fetch", fetcher);
	// Real browsers dispatch media events asynchronously. Happy DOM's src setter
	// dispatches canplay synchronously before the provider finishes loading.
	vi.spyOn(HTMLMediaElement.prototype, "src", "set").mockImplementation(
		function (this: HTMLMediaElement, value) {
			this.setAttribute("src", value);
		},
	);
	vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
	vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(async () => {
	act(() => toast.close());
	cleanup();
	vi.useRealTimers();
	await new Promise((resolve) => setTimeout(resolve, 0));
	for (const router of routers) router.dispose();
	routers.length = 0;
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function RouterProbe() {
	const location = useLocation();
	const navigate = useNavigate();
	return (
		<>
			<output data-testid="location">
				{location.pathname}
				{location.search}
			</output>
			<button type="button" onClick={() => navigate(-1)}>
				History back
			</button>
			<button type="button" onClick={() => navigate(1)}>
				History forward
			</button>
		</>
	);
}

function renderApp(path = "/directories/root", strict = false) {
	const router = createMemoryRouter(
		[
			{
				...libraryRoute,
				element: (
					<>
						<App />
						<RouterProbe />
					</>
				),
			},
		],
		{ initialEntries: [path] },
	);
	routers.push(router);
	const app = (
		<>
			<RouterProvider router={router} />
			<Toaster />
		</>
	);
	return { ...render(strict ? <StrictMode>{app}</StrictMode> : app), router };
}

async function openFile() {
	fireEvent.click(await screen.findByRole("link", { name: "Season 1" }));
	fireEvent.click(await screen.findByRole("link", { name: "Episode 01.mp4" }));
}

test("first-run setup saves the server directory and shows the automatic scan", async () => {
	settings = { resourceRoot: null };
	library = {
		...library,
		ready: false,
		scan: null,
		error: {
			code: "RESOURCE_ROOT_NOT_CONFIGURED",
			message: "Set a resource directory to start using the library.",
		},
	};
	renderApp();
	expect(
		(
			(await screen.findByRole("button", {
				name: "Scan library",
			})) as HTMLButtonElement
		).disabled,
	).toBe(true);
	fireEvent.click(
		within(
			screen.getByRole("navigation", { name: "Primary navigation" }),
		).getByRole("link", { name: "Settings" }),
	);
	const input = (await screen.findByLabelText(
		"Resource directory path",
	)) as HTMLInputElement;
	expect(input.value).toBe("");
	fireEvent.change(input, { target: { value: "/media/中文 videos" } });
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await screen.findByRole("button", { name: "Scan library" });
	expect(screen.getByTestId("location").textContent).toBe("/directories/root");
	expect(
		screen.queryByText("Set a resource directory to start using the library."),
	).toBeNull();
	expect(
		(screen.getByRole("button", { name: "Scan library" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(
		fetcher.mock.calls.some(
			([path, init]) =>
				path === "/api/settings" &&
				init?.method === "PUT" &&
				init.body ===
					JSON.stringify({
						resourceRoot: "/media/中文 videos",
						transcodeCacheBudgetGiB: 10,
						scanIntervalMinutes: 60,
					}),
		),
	).toBe(true);
	expect(
		fetcher.mock.calls.some(([path]) => path === "/api/library/scan"),
	).toBe(false);
	await screen.findByText("Scan: running");
	fireEvent.click(screen.getByRole("link", { name: "Settings" }));
	expect(
		(
			screen.getByRole("button", {
				name: "Save directory",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
});

test("saving a new directory returns from the player and unloads old media", async () => {
	renderApp();
	await openFile();
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	expect(screen.queryByRole("button", { name: "Scan library" })).toBeNull();
	fireEvent.click(screen.getByRole("link", { name: "Settings" }));
	const input = await screen.findByLabelText("Resource directory path");
	fireEvent.change(input, { target: { value: "/new/media" } });
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toBe(
			"/directories/root",
		),
	);
	expect(screen.queryByLabelText("Video: Episode 01.mp4")).toBeNull();
	expect(video.getAttribute("src")).toBeNull();
	expect(screen.queryByRole("link", { name: "Season 1" })).toBeNull();
	expect(screen.getByText("Scan: running")).toBeTruthy();
});

test("a failed settings save retains the input and supports a retry", async () => {
	const implementation = fetcher.getMockImplementation();
	let rejectSave = true;
	fetcher.mockImplementation((input, init) => {
		if (input === "/api/settings" && init?.method === "PUT" && rejectSave)
			return Promise.resolve(
				json(
					{
						error: {
							code: "CONFIG_WRITE_FAILED",
							message: "Settings could not be saved.",
							requestId: "settings-error",
						},
					},
					500,
				),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/settings");
	const input = (await screen.findByLabelText(
		"Resource directory path",
	)) as HTMLInputElement;
	fireEvent.change(input, { target: { value: "/new/media" } });
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await screen.findByText("Settings could not be saved.", {
		selector: "[data-slot=toast-title]",
	});
	expect(within(screen.getByRole("main")).queryByRole("alert")).toBeNull();
	expect(input.value).toBe("/new/media");
	expect(screen.getByTestId("location").textContent).toBe("/settings");
	// The error toast appears before the fetcher returns to idle. Wait until
	// the form is usable so disabled controls are included in the retry.
	await waitFor(() => {
		expect(input.disabled).toBe(false);
		expect(
			(
				screen.getByRole("button", {
					name: "Save directory",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
	});
	rejectSave = false;
	fireEvent.click(screen.getByRole("button", { name: "Save directory" }));
	await screen.findByRole("button", { name: "Scan library" });
	expect(
		fetcher.mock.calls.filter(
			([path, init]) => path === "/api/settings" && init?.method === "PUT",
		),
	).toHaveLength(2);
	expect(settings.resourceRoot).toBe("/new/media");
	await screen.findByText("Settings saved.");
	await waitFor(() =>
		expect(
			screen.queryByText("Settings could not be saved.", {
				selector: "[data-slot=toast-title]",
			}),
		).toBeNull(),
	);
});

test("navigates directories, opens media, and returns to the original directory with media unloaded", async () => {
	renderApp("/directories/root", true);
	await openFile();
	// Wait until the provider loads its source, including StrictMode effect replay.
	await waitFor(() =>
		expect(
			screen.getByLabelText("Video: Episode 01.mp4").getAttribute("src"),
		).toBe(file.originalMediaUrl),
	);
	const video = screen.getByLabelText("Video: Episode 01.mp4");
	expect(video.getAttribute("src")).toBe(file.originalMediaUrl);
	expect(video.hasAttribute("controls")).toBe(false);
	expect(video.closest(".anishelf-player")).toBeTruthy();
	expect(await screen.findByRole("button", { name: "Play" })).toBeTruthy();
	expect(video.getAttribute("preload")).toBe("metadata");
	expect(
		fetcher.mock.calls.some(([path]) => String(path).startsWith("/api/media/")),
	).toBe(false);
	fireEvent.click(screen.getByRole("link", { name: "Back to files" }));
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	expect(
		screen.getByRole("heading", { name: "Directory: Season 1" }),
	).toBeTruthy();
	expect(video.getAttribute("src")).toBeNull();
	expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
	expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
	fireEvent.click(screen.getByRole("link", { name: "Parent directory" }));
	await screen.findByRole("link", { name: "Season 1" });
	expect(
		fetcher.mock.calls.some(([path]) => path === "/api/library/scan"),
	).toBe(false);
});

test("URL navigation supports history back/forward and unloads media when leaving the player", async () => {
	renderApp();
	await openFile();
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	expect(screen.getByTestId("location").textContent).toBe(
		"/files/file-1?directory=season-1",
	);
	fireEvent.click(screen.getByRole("button", { name: "History back" }));
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	expect(screen.getByTestId("location").textContent).toBe(
		"/directories/season-1",
	);
	expect(video.getAttribute("src")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "History forward" }));
	await screen.findByLabelText("Video: Episode 01.mp4");
	expect(screen.getByTestId("location").textContent).toBe(
		"/files/file-1?directory=season-1",
	);
});

test("direct directory links restore the view after remounting", async () => {
	const view = renderApp("/directories/season-1");
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	const path = screen.getByTestId("location").textContent;
	view.unmount();
	view.router.dispose();
	renderApp(path ?? "/directories/root");
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	expect(
		screen.getByRole("link", { name: "Parent directory" }).getAttribute("href"),
	).toBe("/directories/root");
});

test.each(["/files/file-1", "/files/file-1?directory=season-1"])(
	"direct file URL %s restores the player and its parent-directory return link",
	async (path) => {
		renderApp(path);
		await screen.findByLabelText("Video: Episode 01.mp4");
		const back = screen.getByRole("link", { name: "Back to files" });
		expect(back.getAttribute("href")).toBe("/directories/season-1");
		fireEvent.click(back);
		await screen.findByRole("link", { name: "Episode 01.mp4" });
	},
);

test("unknown URLs provide a root link", async () => {
	renderApp("/unknown/page");
	await screen.findByText("Page not found.");
	fireEvent.click(screen.getByRole("link", { name: "Go to root" }));
	await screen.findByRole("heading", { name: "Anime library" });
	expect(screen.getByTestId("location").textContent).toBe("/");
});

test("starts scanning, polls status, refreshes the listing on publication, and stops polling", async () => {
	vi.useFakeTimers();
	library = { ...library, revision: 0, scan: null };
	const root = directories.get("root");
	if (!root) throw new Error("Missing fixture");
	directories.set("root", { ...root, children: [] });
	await act(async () => {
		renderApp();
	});
	expect(screen.getByText("Scan: not started")).toBeTruthy();
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Scan library" }));
	});
	expect(screen.getByText("Scan: running")).toBeTruthy();
	expect(
		(screen.getByRole("button", { name: "Scan library" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(screen.getByText("Visited entries: 2 · Video files: 1")).toBeTruthy();
	library = { ...library, scan: { ...runningScan, visitedCount: 3 } };
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1000);
	});
	expect(screen.getByText("Visited entries: 3 · Video files: 1")).toBeTruthy();
	directories.set("root", root);
	library = {
		...library,
		revision: 1,
		scan: {
			...completedScan,
			warnings: { count: 1, messages: ["An unreadable file was skipped."] },
		},
	};
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1000);
	});
	expect(screen.getByText("Scan: completed")).toBeTruthy();
	fireEvent.click(screen.getByText("Scan warnings: 1"));
	expect(screen.getByText("An unreadable file was skipped.")).toBeTruthy();
	expect(screen.getByRole("link", { name: "Season 1" })).toBeTruthy();
	expect(
		(screen.getByRole("button", { name: "Scan library" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
	const calls = fetcher.mock.calls.length;
	await act(async () => {
		await vi.advanceTimersByTimeAsync(5000);
	});
	expect(fetcher).toHaveBeenCalledTimes(calls);
});

test("scan completion notifies once across StrictMode and repeated refreshes", async () => {
	const notify = vi.spyOn(toast, "add");
	library = { ...library, scan: runningScan };
	const { router } = renderApp("/directories/root", true);
	await screen.findByText("Scan: running");
	expect(notify).not.toHaveBeenCalled();
	library = {
		...library,
		scan: {
			...completedScan,
			warnings: {
				count: 1,
				messages: ["A video file could not be read and was skipped."],
			},
		},
	};
	await act(async () => {
		await router.revalidate();
	});
	await screen.findByText(
		"Library scan completed with 1 warning. See Library scan for details.",
	);
	expect(notify).toHaveBeenCalledTimes(1);
	await act(async () => {
		await router.revalidate();
	});
	expect(notify).toHaveBeenCalledTimes(1);
	expect(screen.getByText("Scan warnings: 1")).toBeTruthy();
});

test("scan status updates do not unload a playing file", async () => {
	renderApp();
	fireEvent.click(await screen.findByRole("link", { name: "Season 1" }));
	fireEvent.click(screen.getByRole("button", { name: "Scan library" }));
	await screen.findByText("Scan: running");
	fireEvent.click(await screen.findByRole("link", { name: "Episode 01.mp4" }));
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	expect(screen.queryByRole("button", { name: "Scan library" })).toBeNull();
	const libraryCalls = fetcher.mock.calls.filter(
		([path]) => path === "/api/library",
	).length;
	library = { ...library, scan: completedScan };
	await waitFor(
		() =>
			expect(
				fetcher.mock.calls.filter(([path]) => path === "/api/library").length,
			).toBeGreaterThan(libraryCalls),
		{ timeout: 2000 },
	);
	expect(screen.getByLabelText("Video: Episode 01.mp4")).toBe(video);
	expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
});

test("a slow background scan poll does not turn the Refresh button into a manual loading state", async () => {
	vi.useFakeTimers();
	library = { ...library, scan: runningScan };
	const implementation = fetcher.getMockImplementation();
	let delayPoll = false;
	let resolvePoll: ((response: Response) => void) | undefined;
	fetcher.mockImplementation((input, init) => {
		if (String(input) === "/api/library" && delayPoll) {
			return new Promise<Response>((resolve) => {
				resolvePoll = resolve;
			});
		}
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	await act(async () => {
		renderApp();
	});
	delayPoll = true;
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1500);
	});
	expect(resolvePoll).toBeTypeOf("function");
	const refresh = screen.getByRole("button", {
		name: "Refresh",
	}) as HTMLButtonElement;
	expect(refresh.disabled).toBe(false);
	expect(refresh.getAttribute("aria-busy")).toBe("false");
	expect(refresh.querySelector(".animate-spin")).toBeNull();
	await act(async () => {
		resolvePoll?.(json({ ...library, scan: completedScan }));
	});
	expect(screen.getByText("Scan: completed")).toBeTruthy();
});

test("a failed scan action keeps the current directory usable and supports another submission", async () => {
	const implementation = fetcher.getMockImplementation();
	let rejectScan = true;
	fetcher.mockImplementation((input, init) => {
		if (String(input) === "/api/library/scan" && rejectScan) {
			return Promise.resolve(
				json(
					{
						error: {
							code: "RESOURCE_ROOT_UNAVAILABLE",
							message: "The resource directory is unavailable.",
							requestId: "scan-error",
						},
					},
					503,
				),
			);
		}
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/directories/season-1");
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	fireEvent.click(screen.getByRole("button", { name: "Scan library" }));
	await screen.findByText("The resource directory is unavailable.", {
		selector: "[data-slot=toast-title]",
	});
	expect(within(screen.getByRole("main")).queryByRole("alert")).toBeNull();
	expect(screen.getByRole("link", { name: "Episode 01.mp4" })).toBeTruthy();
	expect(screen.getByTestId("location").textContent).toBe(
		"/directories/season-1",
	);
	rejectScan = false;
	fireEvent.click(screen.getByRole("button", { name: "Scan library" }));
	await screen.findByText("Scan: running");
	await waitFor(() =>
		expect(
			screen.queryByText("The resource directory is unavailable.", {
				selector: "[data-slot=toast-title]",
			}),
		).toBeNull(),
	);
});

test("a library-status connection failure leaves the listing available and can be revalidated", async () => {
	const implementation = fetcher.getMockImplementation();
	let disconnected = true;
	fetcher.mockImplementation((input, init) => {
		if (String(input) === "/api/library" && disconnected)
			return Promise.reject(new TypeError("private connection details"));
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp();
	await screen.findByRole("link", { name: "Season 1" });
	await screen.findByText(
		"Cannot connect to the server. Check your connection and try again.",
	);
	disconnected = false;
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByText("Scan: completed");
	expect(screen.queryByRole("alert")).toBeNull();
});

test("a missing file shows safe feedback and can be retried", async () => {
	fileError = true;
	renderApp();
	await openFile();
	await screen.findByText(
		"This file is no longer available. Scan the library again.",
	);
	expect(screen.queryByLabelText("Video: Episode 01.mp4")).toBeNull();
	fileError = false;
	fireEvent.click(screen.getByRole("button", { name: "Retry file" }));
	await screen.findByLabelText("Video: Episode 01.mp4");
});

test.each([false, true])(
	"media errors recheck access with missing=%s",
	async (missing) => {
		renderApp();
		await openFile();
		const video = await screen.findByLabelText("Video: Episode 01.mp4");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		fileError = missing;
		Object.defineProperty(video, "error", {
			value: { code: 3, message: "Decode failed" },
		});
		fireEvent.error(video);
		await screen.findByText(
			missing
				? "This file is no longer available. Scan the library again."
				: "This media could not be played in this browser.",
			{ selector: "[data-slot=toast-title]" },
		);
		await waitFor(() =>
			expect(
				fetcher.mock.calls.filter(([path]) => path === "/api/files/file-1"),
			).toHaveLength(2),
		);
	},
);

test("returning while file metadata is pending aborts and discards the old response", async () => {
	const implementation = fetcher.getMockImplementation();
	let signal: AbortSignal | null | undefined;
	let resolve: ((response: Response) => void) | undefined;
	fetcher.mockImplementation((input, init) => {
		if (String(input) === "/api/files/file-1") {
			signal = init?.signal;
			return new Promise<Response>((complete) => {
				resolve = complete;
			});
		}
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp();
	await openFile();
	expect(screen.queryByText("Loading file…")).toBeNull();
	await screen.findByText("Loading file…");
	fireEvent.click(screen.getByRole("link", { name: "Cancel navigation" }));
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	expect(signal?.aborted).toBe(true);
	await act(async () => {
		resolve?.(json(file));
	});
	expect(screen.queryByLabelText("Video: Episode 01.mp4")).toBeNull();
	expect(screen.queryByRole("alert")).toBeNull();
});

test("a removed directory after scanning allows returning to root", async () => {
	renderApp();
	fireEvent.click(await screen.findByRole("link", { name: "Season 1" }));
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	directories.delete("season-1");
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByText("The resource was not found.");
	fireEvent.click(screen.getByRole("link", { name: "Go to root" }));
	await screen.findByRole("link", { name: "Season 1" });
});

test("an unavailable library shows the error, and refresh recovers scanning", async () => {
	library = {
		...library,
		ready: false,
		stale: true,
		error: {
			code: "RESOURCE_ROOT_UNAVAILABLE",
			message: "The resource directory is unavailable.",
		},
	};
	renderApp();
	await screen.findByText("The resource directory is unavailable.");
	expect(
		(screen.getByRole("button", { name: "Scan library" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(screen.getByText("Showing the previous scan results.")).toBeTruthy();
	library = { ...library, ready: true, stale: false, error: null };
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() =>
		expect(
			(
				screen.getByRole("button", {
					name: "Scan library",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false),
	);
	expect(
		screen.queryByText("The resource directory is unavailable."),
	).toBeNull();
});

test("StrictMode opens one session, restores server history, saves seeks including zero with the same generation", async () => {
	const implementation = fetcher.getMockImplementation();
	fetcher.mockImplementation((input, init) => {
		if (String(input) === "/api/playback/sessions")
			return Promise.resolve(
				json(
					{
						token: "session-token",
						generation: 1,
						sourceVersion: "version",
						file: file.file,
						plan: {
							mode: "direct",
							resource: {
								delivery: "file" as const,
								url: file.originalMediaUrl,
								mimeType: "video/mp4",
								timeline: {
									sourceOriginMs: 0,
									mediaOriginMs: 0,
									sourceDurationMs: null,
								},
							},
						},
						progress: {
							positionMs: 40000,
							durationMs: 100000,
							lastViewedAtMs: 1,
							generation: 1,
							lastSequence: 0,
						},
					},
					201,
				),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/files/file-1", true);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(([path]) => path === "/api/playback/sessions"),
		).toBe(true),
	);
	const video = await screen.findByLabelText<HTMLVideoElement>(
		"Video: Episode 01.mp4",
	);
	Object.defineProperty(video, "duration", { value: 100 });
	fireEvent.loadedMetadata(video);
	await act(async () => {});
	expect(video.currentTime).toBe(40);
	expect(
		fetcher.mock.calls.filter(([path]) => path === "/api/playback/sessions"),
	).toHaveLength(1);
	expect(
		fetcher.mock.calls.filter(([path]) => String(path).endsWith("/progress")),
	).toHaveLength(0);
	video.currentTime = 10;
	fireEvent.seeked(video);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(
				([path, init]) =>
					String(path).endsWith("/progress") &&
					JSON.parse(String(init?.body)).positionMs === 10000,
			),
		).toBe(true),
	);
	video.currentTime = 0;
	fireEvent.seeked(video);
	video.currentTime = 2;
	fireEvent.seeked(video);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(
				([path, init]) =>
					String(path).endsWith("/progress") &&
					JSON.parse(String(init?.body)).generation === 1 &&
					JSON.parse(String(init?.body)).positionMs === 2000,
			),
		).toBe(true),
	);
});

test("normal navigation saves in the background, then releases the session", async () => {
	const implementation = fetcher.getMockImplementation();
	let resolveSave: ((value: Response) => void) | undefined;
	fetcher.mockImplementation((input, init) => {
		if (String(input).endsWith("/progress"))
			return new Promise<Response>((resolve) => {
				resolveSave = resolve;
			});
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/files/file-1");
	const video = await screen.findByLabelText<HTMLVideoElement>(
		"Video: Episode 01.mp4",
	);
	Object.defineProperty(video, "duration", { value: 100 });
	fireEvent.loadedMetadata(video);
	await act(async () => {});
	video.currentTime = 15;
	fireEvent.click(screen.getByRole("link", { name: "Back to files" }));
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	await waitFor(() => expect(resolveSave).toBeDefined());
	await act(async () =>
		resolveSave?.(
			json({
				status: "saved",
				progress: {
					positionMs: 15000,
					durationMs: 100000,
					generation: 1,
					lastSequence: 1,
					lastViewedAtMs: 1,
				},
			}),
		),
	);
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(
				([path, init]) =>
					path === "/api/playback/sessions/session-token" &&
					init?.method === "DELETE",
			),
		).toBe(true),
	);
});

test("playback session errors show a Toast and retry without unloading the video", async () => {
	const implementation = fetcher.getMockImplementation();
	const notify = vi.spyOn(toast, "add");
	let rejectSession = true;
	fetcher.mockImplementation((input, init) => {
		if (String(input) === "/api/playback/sessions" && rejectSession)
			return Promise.resolve(
				json(
					{
						error: {
							code: "PLAYBACK_UNAVAILABLE",
							message: "Unavailable",
							requestId: "id",
						},
					},
					503,
				),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/files/file-1", true);
	await screen.findByText(
		"Playback progress is unavailable. You can keep watching and retry later.",
		{ selector: "[data-slot=toast-title]" },
	);
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	expect(notify).toHaveBeenCalledTimes(1);
	rejectSession = false;
	const retry = screen.getByText("Retry", {
		selector: "[data-slot=toast-action]",
	});
	act(() => retry.focus());
	fireEvent.click(retry);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter(([url]) => url === "/api/playback/sessions"),
		).toHaveLength(2),
	);
	await waitFor(() =>
		expect(
			screen.queryByText(
				"Playback progress is unavailable. You can keep watching and retry later.",
				{ selector: "[data-slot=toast-title]" },
			),
		).toBeNull(),
	);
	expect(screen.getByLabelText("Video: Episode 01.mp4")).toBe(video);
});

test("progress save failures notify once and retry the pending save", async () => {
	const implementation = fetcher.getMockImplementation();
	const notify = vi.spyOn(toast, "add");
	let rejectSave = true;
	fetcher.mockImplementation((input, init) => {
		if (String(input).endsWith("/progress") && rejectSave)
			return Promise.resolve(
				json(
					{
						error: {
							code: "PLAYBACK_PERSISTENCE_FAILED",
							message: "Failed",
							requestId: "id",
						},
					},
					500,
				),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/files/file-1");
	const video = await screen.findByLabelText<HTMLVideoElement>(
		"Video: Episode 01.mp4",
	);
	Object.defineProperty(video, "duration", { value: 100 });
	fireEvent.loadedMetadata(video);
	await act(async () => {});
	video.currentTime = 15;
	fireEvent.seeked(video);
	await screen.findByText(
		"Playback progress could not be loaded or saved. Please retry.",
		{ selector: "[data-slot=toast-title]" },
	);
	expect(notify).toHaveBeenCalledTimes(1);
	fireEvent.pause(video);
	await act(async () => {});
	expect(notify).toHaveBeenCalledTimes(1);
	rejectSave = false;
	const retry = screen.getByText("Retry", {
		selector: "[data-slot=toast-action]",
	});
	act(() => retry.focus());
	fireEvent.click(retry);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter(([url]) => String(url).endsWith("/progress")),
		).toHaveLength(2),
	);
	const writes = fetcher.mock.calls.filter(([url]) =>
		String(url).endsWith("/progress"),
	);
	expect(JSON.parse(String(writes[1]?.[1]?.body))).toEqual(
		JSON.parse(String(writes[0]?.[1]?.body)),
	);
	await waitFor(() =>
		expect(
			screen.queryByText(
				"Playback progress could not be loaded or saved. Please retry.",
				{ selector: "[data-slot=toast-title]" },
			),
		).toBeNull(),
	);
	expect(screen.getByLabelText("Video: Episode 01.mp4")).toBe(video);
});

test("failed final saves do not show session messages or block navigation", async () => {
	const implementation = fetcher.getMockImplementation();
	fetcher.mockImplementation((input, init) => {
		if (String(input).endsWith("/progress"))
			return Promise.resolve(
				json(
					{
						error: {
							code: "PLAYBACK_PERSISTENCE_FAILED",
							message: "Failed",
							requestId: "id",
						},
					},
					500,
				),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/files/file-1");
	const video = await screen.findByLabelText<HTMLVideoElement>(
		"Video: Episode 01.mp4",
	);
	Object.defineProperty(video, "duration", { value: 100 });
	fireEvent.loadedMetadata(video);
	await act(async () => {});
	video.currentTime = 15;
	fireEvent.click(screen.getByRole("link", { name: "Back to files" }));
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	expect(
		screen.queryByText(
			"Playback progress could not be loaded or saved. Please retry.",
		),
	).toBeNull();
	expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();
});

test("settings shows the default scan interval and saves the user's disabled schedule", async () => {
	renderApp("/settings");
	const interval = await screen.findByLabelText(
		"Automatic scan interval (minutes)",
	);
	expect((interval as HTMLInputElement).value).toBe("60");
	fireEvent.change(interval, { target: { value: "0" } });
	fireEvent.submit(interval.closest("form") as HTMLFormElement);
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toBe(
			"/directories/root",
		),
	);
	expect(
		fetcher.mock.calls.some(
			([path, init]) =>
				path === "/api/settings" &&
				init?.method === "PUT" &&
				JSON.parse(String(init.body)).scanIntervalMinutes === 0,
		),
	).toBe(true);
	fireEvent.click(
		within(
			screen.getByRole("navigation", { name: "Primary navigation" }),
		).getByRole("link", { name: "Settings" }),
	);
	expect(
		(
			(await screen.findByLabelText(
				"Automatic scan interval (minutes)",
			)) as HTMLInputElement
		).value,
	).toBe("0");
});

test("history displays saved progress and opens the player with its directory context", async () => {
	const implementation = fetcher.getMockImplementation();
	fetcher.mockImplementation((input, init) => {
		if (String(input) === "/api/history")
			return Promise.resolve(
				json({
					availability: "checked",
					items: [
						{
							file: file.file,
							progress: {
								positionMs: 40000,
								durationMs: 100000,
								lastViewedAtMs: 1000,
								generation: 1,
								lastSequence: 1,
							},
						},
					],
				}),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/history");
	await screen.findByRole("heading", { name: "Playback history" });
	expect(screen.getByText("0:40 / 1:40")).toBeTruthy();
	fireEvent.click(screen.getByRole("link", { name: "Resume: Episode 01.mp4" }));
	await screen.findByLabelText("Video: Episode 01.mp4");
	expect(screen.getByTestId("location").textContent).toContain(
		"/files/file-1?directory=season-1",
	);
});

test.each(["checked", "unknown"])(
	"history explains its %s empty state",
	async (availability) => {
		const implementation = fetcher.getMockImplementation();
		fetcher.mockImplementation((input, init) => {
			if (String(input) === "/api/history")
				return Promise.resolve(json({ availability, items: [] }));
			if (!implementation) throw new Error("Missing mock");
			return implementation(input, init);
		});
		renderApp("/history");
		await screen.findByText(
			availability === "unknown"
				? "Scan your library to check which watched files are available."
				: "No playback history yet. Watch a file from your library to see it here.",
		);
	},
);

test("settings use shared constraints without requesting client configuration", async () => {
	renderApp("/settings");
	const interval = await screen.findByLabelText<HTMLInputElement>(
		"Automatic scan interval (minutes)",
	);
	expect(interval.value).toBe("60");
	expect(interval.max).toBe("10080");
	fireEvent.change(interval, { target: { value: "10081" } });
	fireEvent.submit(interval.closest("form") as HTMLFormElement);
	expect(
		await screen.findByText("Enter a whole number from 0 to 10080 minutes."),
	).toBeTruthy();
	expect(
		fetcher.mock.calls.some(
			([url, init]) => url === "/api/settings" && init?.method === "PUT",
		),
	).toBe(false);
	expect(
		fetcher.mock.calls.some(([url]) => String(url).includes("client-config")),
	).toBe(false);
});

test("file rows offer a dropdown menu for copying without opening playback", async () => {
	const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
	renderApp();
	await screen.findByRole("link", { name: "Season 1" });
	expect(screen.queryByRole("button", { name: "Copy media link" })).toBeNull();
	fireEvent.click(screen.getByRole("link", { name: "Season 1" }));
	await screen.findByRole("button", {
		name: "This browser reports support for this file.",
	});
	const trigger = await screen.findByRole("button", { name: "File actions" });
	fireEvent.click(trigger);
	const button = await screen.findByRole("menuitem", {
		name: "Copy media link",
	});
	expect(button.closest("a")).toBeNull();
	fireEvent.click(button);
	await screen.findByText(/Link copied/);
	expect(copy).toHaveBeenCalledWith(
		`${window.location.origin}/api/media/file-1`,
	);
	expect(screen.getByTestId("location").textContent).toBe(
		"/directories/season-1",
	);
	expect(
		fetcher.mock.calls.some(([url]) => url === "/api/playback/sessions"),
	).toBe(false);
});

test("supported media shows compatibility information in a dialog below the player", async () => {
	renderApp("/files/file-1");
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(
		screen.queryByText("This browser reports support for this file."),
	).toBeNull();
	const trigger = screen.getByRole("button", {
		name: "Playback compatibility info",
	});
	expect(
		video.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();
	fireEvent.click(trigger);
	const dialog = await screen.findByRole("dialog", {
		name: "Playback compatibility",
	});
	expect(
		within(dialog).getByText("This browser reports support for this file."),
	).toBeTruthy();
	fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("unsupported media displays a preparation hint without opening a modal or creating work", async () => {
	compatibilityStatus = "unsupported";
	renderApp("/files/file-1");
	await screen.findByText("This file is not supported by this browser.");
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(screen.queryByLabelText("Video: Episode 01.mp4")).toBeNull();
	const call = fetcher.mock.calls.find(
		([path, init]) =>
			path === "/api/playback/selection" && init?.method === "POST",
	);
	expect(JSON.parse(String(call?.[1]?.body)).original).toMatchObject({
		descriptionId: "a".repeat(64),
		output: null,
		sourceVersion: "version",
	});
	expect(
		fetcher.mock.calls.some(
			([url, init]) =>
				String(url).includes("/preparations") && init?.method === "POST",
		),
	).toBe(false);
});

test("unknown media keeps an explicit original attempt and manual compatibility details", async () => {
	compatibilityStatus = "unknown";
	renderApp("/files/file-1");
	await screen.findByText("Playback compatibility could not be confirmed.");
	expect(screen.queryByRole("dialog")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Try original file" }));
	await screen.findByLabelText("Video: Episode 01.mp4");
	fireEvent.click(
		screen.getByRole("button", { name: "Playback compatibility info" }),
	);
	await screen.findByRole("dialog", { name: "Playback compatibility" });
});

test("an unavailable compatibility check remains retryable and permits an explicit attempt", async () => {
	const implementation = fetcher.getMockImplementation();
	fetcher.mockImplementation((input, init) => {
		if (String(input).startsWith("/api/playback/options"))
			return Promise.resolve(
				json(
					{
						error: {
							code: "MEDIA_INSPECTION_UNAVAILABLE",
							message: "Unavailable",
							requestId: "id",
						},
					},
					503,
				),
			);
		if (!implementation) throw new Error("Missing mock");
		return implementation(input, init);
	});
	renderApp("/files/file-1");
	await screen.findByText(
		"Compatibility could not be checked. You can retry or try the original file.",
		undefined,
		{ timeout: 3000 },
	);
	fireEvent.click(screen.getByRole("button", { name: "Try original file" }));
	await screen.findByLabelText("Video: Episode 01.mp4");
});

test("unsupported file uses a ready transcode automatically without a terminal task panel", async () => {
	compatibilityStatus = "unsupported";
	preparationTasks = [
		{
			id: "prepared-task",
			fileId: file.file.id,
			filename: file.file.name,
			sourceVersion: "version",
			profileId: "builtin:web",
			mode: "remux",
			reasons: { video: "copy", audio: "copy" },
			status: "ready",
			playbackAvailability: "ready",
			progress: null,
			failureReason: null,
			createdAtMs: 1,
			updatedAtMs: 1,
			artifactId: "artifact",
			resource: {
				delivery: "file" as const,
				url: "/api/prepared-media/artifact",
				mimeType: "video/mp4",
				timeline: {
					sourceOriginMs: 0,
					mediaOriginMs: 0,
					sourceDurationMs: null,
				},
			},
			sizeBytes: 100,
		},
	];
	renderApp("/files/file-1");
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	await waitFor(() =>
		expect(video.getAttribute("src")).toBe("/api/prepared-media/artifact"),
	);
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(
		screen.queryByRole("complementary", { name: "Transcoding tasks" }),
	).toBeNull();
	fireEvent.click(screen.getByRole("link", { name: "Files" }));
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toBe(
			"/directories/root",
		),
	);
	expect(
		screen.queryByRole("complementary", { name: "Transcoding tasks" }),
	).toBeNull();
	expect(screen.queryByRole("link", { name: "Media preparation" })).toBeNull();
	expect(
		fetcher.mock.calls.some(
			([url, init]) =>
				String(url).includes("/preparations") && init?.method === "POST",
		),
	).toBe(false);
});

test("file menu preserves manual copy fallback after closing", async () => {
	vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
		new Error("Clipboard unavailable"),
	);
	renderApp("/directories/season-1");
	fireEvent.click(await screen.findByRole("button", { name: "File actions" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Copy media link" }),
	);
	const field = await screen.findByRole("textbox", { name: "Media link" });
	expect((field as HTMLInputElement).value).toBe(
		`${window.location.origin}/api/media/file-1`,
	);
	expect(screen.queryByRole("menu")).toBeNull();
});

test("poster library filters local titles, preserves return context and selects an actual source version", async () => {
	const detail = animeFixture();
	mockAnime(detail);
	renderApp("/?query=Frieren&sort=recent");
	const card = await screen.findByRole("link", { name: "Frieren" });
	expect(screen.getByText("1 / 3 regular episodes available")).toBeTruthy();
	fireEvent.click(card);
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
	const episode = screen.getByText("Episode 1").closest("li");
	expect(episode).toBeTruthy();
	fireEvent.click(
		within(episode as HTMLElement).getByRole("button", {
			name: "Play: Episode 1",
		}),
	);
	const dialog = await screen.findByRole("dialog");
	expect(within(dialog).getAllByText(/1080p · Group A/)).toHaveLength(3);
	expect(within(dialog).getAllByRole("link", { name: "Play" })).toHaveLength(2);
	expect(within(dialog).getAllByText(/opens its normal timeline/)).toHaveLength(
		3,
	);
	fireEvent.click(
		within(dialog).getAllByRole("link", { name: "Play" })[0] as HTMLElement,
	);
	await screen.findByLabelText("Video: Episode 01.mp4");
	expect(
		fetcher.mock.calls.some(([path]) =>
			String(path).startsWith("/api/files/file-1/subtitles"),
		),
	).toBe(true);
	const back = screen.getByRole("link", { name: "Back to anime" });
	expect(back.getAttribute("href")).toContain("#episode-ep-1");
	expect(screen.getByTestId("location").textContent).toContain(
		"version=source-v1",
	);
	fireEvent.click(back);
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
	fireEvent.click(screen.getByRole("link", { name: "Back to library" }));
	await screen.findByRole("heading", { name: "Anime library" });
	expect(screen.getByTestId("location").textContent).toBe(
		"/?query=Frieren&sort=recent",
	);
	expect(
		(screen.getByLabelText("Search local titles") as HTMLInputElement).value,
	).toBe("Frieren");
	expect(document.activeElement?.id).toBe("work-work-1");
});

test("detail renders unknown/missing/unavailable separately and sanitizes provider descriptions", async () => {
	const detail = animeFixture();
	mockAnime(detail);
	renderApp("/anime/work-1");
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
	expect(screen.getByText("Safe synopsis").tagName).toBe("B");
	expect(document.querySelector("main script")).toBeNull();
	expect(
		document.querySelector('main img[src*="tracking.invalid"]'),
	).toBeNull();
	expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
	expect(screen.getByText("Unknown")).toBeTruthy();
	expect(
		screen
			.getByRole("button", { name: "Play: Episode 2" })
			.hasAttribute("disabled"),
	).toBe(true);
	expect(
		screen
			.getByRole("button", { name: "Play: Episode 3" })
			.hasAttribute("disabled"),
	).toBe(true);
	expect(screen.getByText(/No associated local file/)).toBeTruthy();
	expect(screen.queryByText("Hidden spoiler")).toBeNull();
	fireEvent.click(screen.getByText("More metadata"));
	fireEvent.click(screen.getByRole("button", { name: "Show spoiler tags" }));
	expect(screen.getByText("Hidden spoiler")).toBeTruthy();
});

test("a single usable version links directly to playback and provider refresh failure keeps it usable", async () => {
	const detail = animeFixture();
	const episode = detail.episodes[0];
	if (!episode) throw new Error("Missing fixture episode");
	episode.versions = episode.versions.slice(0, 1);
	detail.metadata.refreshError = {
		code: "unavailable",
		message: "Unavailable",
		retryAt: null,
	};
	mockAnime(detail);
	renderApp("/anime/work-1?library=https%3A%2F%2Fevil.invalid");
	const play = await screen.findByRole("link", { name: "Play: Episode 1" });
	expect(play.getAttribute("href")).toContain("library=%2F");
	expect(
		screen.getByRole("link", { name: "Back to library" }).getAttribute("href"),
	).toBe("/");
	fireEvent.click(screen.getByRole("button", { name: "Refresh metadata" }));
	await screen.findByRole("alert");
	expect(screen.getByRole("link", { name: "Play: Episode 1" })).toBeTruthy();
});

test("filter submission resets pagination and sends all filters to the local catalog", async () => {
	const detail = animeFixture();
	mockAnime(detail);
	renderApp("/?page=2");
	await screen.findByRole("link", { name: "Frieren" });
	fireEvent.change(screen.getByLabelText("Search local titles"), {
		target: { value: "葬送" },
	});
	fireEvent.change(screen.getByLabelText("Format"), {
		target: { value: "TV" },
	});
	fireEvent.change(screen.getByLabelText("Release year"), {
		target: { value: "2023" },
	});
	fireEvent.change(screen.getByLabelText("Availability"), {
		target: { value: "available" },
	});
	fireEvent.change(screen.getByLabelText("Sort by"), {
		target: { value: "recent" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
	await waitFor(() => expect(screen.getByText("Page 1")).toBeTruthy());
	expect(
		fetcher.mock.calls.some(([path]) => {
			const url = new URL(String(path), "http://localhost");
			return (
				url.pathname === "/api/catalog/works" &&
				url.searchParams.get("query") === "葬送" &&
				url.searchParams.get("format") === "TV" &&
				url.searchParams.get("year") === "2023" &&
				url.searchParams.get("availability") === "available" &&
				url.searchParams.get("sort") === "recent" &&
				!url.searchParams.has("page")
			);
		}),
	).toBe(true);
	expect(
		fetcher.mock.calls.some(([path]) =>
			String(path).startsWith("/api/metadata/search"),
		),
	).toBe(false);
});

test("the default poster wall exposes an empty state and access to Files", async () => {
	renderApp("/");
	await screen.findByText(/No associated anime yet/);
	expect(
		screen
			.getAllByRole("link", { name: "Files" })
			.every((link) => link.getAttribute("href") === "/directories/root"),
	).toBe(true);
});

function mockAnime(detail: ReturnType<typeof animeFixture>) {
	const fallback = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path.startsWith("/api/catalog/works?"))
			return json({
				items: [detail.work],
				page: Number(
					new URL(path, "http://localhost").searchParams.get("page") ?? 1,
				),
				perPage: 24,
				hasNextPage: true,
			});
		if (path === "/api/catalog/works/work-1") return json(detail);
		if (path === "/api/catalog/works/work-1/refresh") return json(detail);
		if (path.startsWith("/api/metadata/anilist/154587/relations"))
			return json({
				snapshotId: "relations",
				fetchedAt: 1,
				stale: false,
				refreshing: false,
				refreshError: null,
				data: { items: [], page: 1, perPage: 25, hasNextPage: false },
			});
		if (!fallback) throw new Error("Missing fetch fixture");
		return fallback(input, init);
	});
}

test("failed poster artwork falls back to the real title without losing the work link", async () => {
	mockAnime(animeFixture());
	renderApp("/");
	await screen.findByRole("link", { name: "Frieren" });
	fireEvent.error(screen.getByRole("img", { name: "Frieren" }));
	expect(screen.queryByRole("img", { name: "Frieren" })).toBeNull();
	expect(screen.getByRole("link", { name: "Frieren" })).toBeTruthy();
});

test("unavailable anime playback retains its detail return link for choosing another version", async () => {
	mockAnime(animeFixture());
	fileError = true;
	renderApp(
		"/files/file-1?anime=work-1&episode=ep-1&library=%2F%3Fquery%3DFrieren&version=source-v1",
	);
	await screen.findByRole("alert");
	const back = screen.getByRole("link", { name: "Back to anime" });
	expect(back.getAttribute("href")).toBe(
		"/anime/work-1?library=%2F%3Fquery%3DFrieren#episode-ep-1",
	);
	fireEvent.click(back);
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
});

test("anime version links pin the selected source version and refuse a replaced source", async () => {
	const fallback = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (input, init) => {
		if (String(input) === "/api/playback/options") {
			const intent = JSON.parse(String(init?.body));
			expect(intent.sourceVersion).toBe("replaced-version");
			return json(
				{
					error: {
						code: "PLAYBACK_CONFLICT",
						message: "Source changed",
						requestId: "version-conflict",
					},
				},
				409,
			);
		}
		if (!fallback) throw new Error("Missing fixture");
		return fallback(input, init);
	});
	renderApp("/files/file-1?anime=work-1&episode=ep-1&version=replaced-version");
	await screen.findByRole("heading", { name: "Unable to play this video" });
	expect(screen.queryByLabelText("Video: Episode 01.mp4")).toBeNull();
	expect(screen.getByRole("link", { name: "Back to anime" })).toBeTruthy();
});

function mockReview(confirmed = false) {
	const item = reviewFixture(confirmed);
	const detail = animeFixture();
	const fallback = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path.startsWith("/api/catalog/reviews?"))
			return json({ items: [item], page: 1, perPage: 20, hasNextPage: false });
		if (path === `/api/catalog/reviews/${item.id}`) return json(item);
		if (path.startsWith("/api/metadata/search?"))
			return json({
				...detail.metadata,
				data: {
					items: [detail.metadata.data],
					page: 1,
					perPage: 10,
					hasNextPage: false,
				},
			});
		if (path === "/api/metadata/anilist/154587") return json(detail.metadata);
		if (path === "/api/catalog/previews") {
			const body = JSON.parse(String(init?.body));
			const row = body.rows[0];
			return json({
				id: "preview-1",
				expiresAt: Date.now() + 60000,
				reference: body.reference,
				workId: confirmed ? "work-1" : null,
				workRevision: confirmed ? 1 : null,
				metadata: detail.metadata,
				rows: [
					{
						reviewId: item.id,
						revision: item.revision,
						relativePath: item.relativePath,
						rawNumbers: item.evidence.rawEpisodes,
						before: item.associations.map(
							({ workId, episodeId, kind, number }) => ({
								workId,
								episodeId,
								kind,
								number,
							}),
						),
						targets: row.targets.map(
							(target: { kind: string; number: string }) => ({
								...target,
								number:
									target.kind === "regular"
										? String(Number(target.number) + row.offset)
										: target.number,
							}),
						),
						offset: row.offset,
						reason: row.reason,
					},
				],
			});
		}
		if (path === "/api/catalog/confirmations") {
			item.decision = "confirmed";
			item.revision += 1;
			return json({ workId: "work-1", revision: 2, reviewIds: [item.id] });
		}
		if (path === `/api/catalog/reviews/${item.id}/remove`) {
			item.associations = [];
			item.decision = "rejected";
			item.revision += 1;
			return json(item);
		}
		if (!fallback) throw new Error("Missing fixture");
		return fallback(input, init);
	});
	return item;
}
async function selectReviewWork() {
	const input = await screen.findByLabelText("AniList ID or anime URL");
	fireEvent.change(input, {
		target: { value: "https://anilist.co/anime/154587/Frieren" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Look up" }));
	await screen.findByLabelText("Episode numbers");
}

test("failed recognition can be manually looked up, corrected with an offset preview and admitted", async () => {
	const item = mockReview();
	renderApp(`/review?item=${item.id}`);
	await selectReviewWork();
	fireEvent.change(screen.getByLabelText("Episode numbers"), {
		target: { value: "3" },
	});
	fireEvent.change(screen.getByLabelText("Regular numbering offset"), {
		target: { value: "-1" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Preview association" }));
	await screen.findByText("Episode 2", { exact: true });
	fireEvent.click(screen.getByRole("button", { name: "Confirm association" }));
	await screen.findByRole("link", { name: "Open anime" });
	const body = fetcher.mock.calls.find(
		([path]) => path === "/api/catalog/confirmations",
	)?.[1]?.body;
	expect(JSON.parse(String(body))).toMatchObject({
		previewId: "preview-1",
		replace: false,
	});
});

test("correcting an automatically associated file requires explicit replacement", async () => {
	const item = mockReview(true);
	renderApp(`/review?item=${item.id}`);
	await selectReviewWork();
	fireEvent.change(screen.getByLabelText("Episode numbers"), {
		target: { value: "2" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Preview association" }));
	const confirm = await screen.findByRole("button", {
		name: "Confirm association",
	});
	expect(confirm.hasAttribute("disabled")).toBe(true);
	fireEvent.click(screen.getByRole("checkbox", { name: /Explicitly replace/ }));
	fireEvent.click(confirm);
	await screen.findByRole("link", { name: "Open anime" });
	const body = fetcher.mock.calls.find(
		([path]) => path === "/api/catalog/confirmations",
	)?.[1]?.body;
	expect(JSON.parse(String(body)).replace).toBe(true);
});

function playbackTitleFixture(): CatalogSourceResponse {
	return {
		sourceVersion: "version",
		associations: [1, 2].map((number) => ({
			workId: "work-1",
			workTitle: "Local Frieren",
			episodeId: `episode-${number}`,
			kind: "regular",
			number: String(number),
			label: "Custom episode title",
		})),
	};
}

test.each([
	["/files/file-1", "Local Frieren — Episode 1, Episode 2"],
	["/files/file-1?anime=work-1&episode=episode-2", "Local Frieren — Episode 2"],
])(
	"matched playback titles use work and mapped numbering: %s",
	async (path, title) => {
		const fallback = fetcher.getMockImplementation();
		fetcher.mockImplementation(async (input, init) =>
			String(input) === "/api/catalog/sources/file-1"
				? json(playbackTitleFixture())
				: requiredFetch(fallback)(input, init),
		);
		renderApp(path);
		await screen.findByRole("heading", { name: title });
		await screen.findByLabelText(`Video: ${title}`);
	},
);

function requiredFetch(
	value: ReturnType<typeof fetcher.getMockImplementation>,
) {
	if (!value) throw new Error("Missing fetch mock");
	return value;
}

test("late title corrections update the existing video without restarting playback", async () => {
	renderApp("/files/file-1");
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	await act(async () => {
		queryClient.setQueriesData(
			{
				queryKey: ["catalog"],
				predicate: (query) => query.queryKey[2] === "source",
			},
			playbackTitleFixture(),
		);
	});
	await screen.findByRole("heading", {
		name: "Local Frieren — Episode 1, Episode 2",
	});
	expect(
		screen.getByLabelText("Video: Local Frieren — Episode 1, Episode 2"),
	).toBe(video);
});

test.each(["version-old", "unavailable"])(
	"unmatched or stale catalog data preserves filename: %s",
	async (status) => {
		const fallback = requiredFetch(fetcher.getMockImplementation());
		fetcher.mockImplementation(async (input, init) => {
			if (String(input) !== "/api/catalog/sources/file-1")
				return fallback(input, init);
			return status === "unavailable"
				? json(
						{ error: { code: "CATALOG_UNAVAILABLE", message: "Offline" } },
						503,
					)
				: json({ ...playbackTitleFixture(), sourceVersion: status });
		});
		renderApp("/files/file-1");
		await screen.findByLabelText("Video: Episode 01.mp4");
		expect(
			screen.getByRole("heading", { name: "Episode 01.mp4" }),
		).toBeTruthy();
	},
);

test("review status filters and editor return preserve the current list page", async () => {
	mockReview(true);
	const { router } = renderApp("/review?decision=confirmed&page=3");
	const filters = await screen.findByRole("navigation", {
		name: "Show decisions",
	});
	expect(
		within(filters)
			.getByRole("link", { name: "Associated" })
			.getAttribute("aria-current"),
	).toBe("page");
	fireEvent.click(
		await screen.findByRole("link", { name: "Correct associations" }),
	);
	const back = await screen.findByRole("link", { name: "Back to review" });
	expect(back.getAttribute("href")).toBe("/review?decision=confirmed&page=3");
	fireEvent.click(back);
	await screen.findByRole("link", { name: "Correct associations" });
	fireEvent.click(
		within(
			screen.getByRole("navigation", { name: "Show decisions" }),
		).getByRole("link", { name: "Needs review" }),
	);
	await waitFor(() =>
		expect(router.state.location.search).toBe("?decision=pending"),
	);
});

test("review removal stays separate from correction and retains explicit consent", async () => {
	const item = mockReview(true);
	renderApp(`/review?item=${item.id}&decision=confirmed`);
	await screen.findByRole("heading", { name: "Choose the anime" });
	const section = screen
		.getByText("Remove associations", { selector: "summary" })
		.closest("details");
	expect(section?.hasAttribute("open")).toBe(false);
	fireEvent.click(
		screen.getByText("Remove associations", { selector: "summary" }),
	);
	fireEvent.change(screen.getByLabelText("Rejection or removal reason"), {
		target: { value: "Wrong anime" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Remove associations" }));
	await screen.findByRole("alert");
	expect(
		fetcher.mock.calls.some(([path]) => String(path).endsWith("/remove")),
	).toBe(false);
	fireEvent.click(screen.getByRole("checkbox", { name: /Explicitly remove/ }));
	fireEvent.click(screen.getByRole("button", { name: "Remove associations" }));
	await waitFor(() => expect(item.decision).toBe("rejected"));
});

test("editing mapped numbers invalidates the previous association preview", async () => {
	const item = mockReview(true);
	renderApp(`/review?item=${item.id}`);
	await selectReviewWork();
	fireEvent.click(screen.getByRole("button", { name: "Preview association" }));
	await screen.findByRole("heading", { name: "Association preview" });
	fireEvent.click(screen.getByRole("checkbox", { name: /Explicitly replace/ }));
	fireEvent.change(screen.getByLabelText("Episode numbers"), {
		target: { value: "2" },
	});
	expect(
		screen.queryByRole("button", { name: "Confirm association" }),
	).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Preview association" }));
	expect(
		(
			await screen.findByRole("button", { name: "Confirm association" })
		).hasAttribute("disabled"),
	).toBe(true);
});

test("a failed confirmation retains the form and reuses its preview operation key on retry", async () => {
	const item = mockReview();
	const fallback = fetcher.getMockImplementation();
	let attempts = 0;
	fetcher.mockImplementation(async (input, init) => {
		if (String(input) === "/api/catalog/confirmations" && attempts++ === 0)
			return json(
				{
					error: {
						code: "CATALOG_UNAVAILABLE",
						message: "Try again",
						requestId: "retry",
					},
				},
				503,
			);
		if (!fallback) throw new Error("Missing fixture");
		return fallback(input, init);
	});
	renderApp(`/review?item=${item.id}`);
	await selectReviewWork();
	fireEvent.change(screen.getByLabelText("Episode numbers"), {
		target: { value: "3" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Preview association" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "Confirm association" }),
	);
	await screen.findByRole("alert");
	expect(
		(screen.getByLabelText("Episode numbers") as HTMLInputElement).value,
	).toBe("3");
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Confirm association" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Confirm association" }));
	await screen.findByRole("link", { name: "Open anime" });
	const requests = fetcher.mock.calls
		.filter(([url]) => url === "/api/catalog/confirmations")
		.map(([, init]) => JSON.parse(String(init?.body)));
	expect(requests).toHaveLength(2);
	expect(requests[1]).toEqual(requests[0]);
});
