// @vitest-environment happy-dom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { StrictMode } from "react";
import { createMemoryRouter, useLocation, useNavigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../src/App.js";
import type {
	DirectoryResponse,
	FileResponse,
	LibraryResponse,
	PlaybackSessionResponse,
	PreparationTaskResponse,
	ScanStateDto,
	SettingsResponse,
} from "../src/api/contracts.js";
import { Toaster, toast } from "../src/components/ui/toast.js";
import { clearOriginalCompatibilityCache } from "../src/lib/media-compatibility.js";
import { libraryRoute } from "../src/routes/library.js";

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
	playbackUrl: "/api/media/file-1",
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
	clearOriginalCompatibilityCache();
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
		if (path === "/api/preparations" || path.startsWith("/api/preparations?"))
			return json({ tasks: preparationTasks });
		if (path === "/api/transcode-profiles")
			return json({
				profiles: [
					{
						id: "builtin:web",
						name: "Browser",
						description: "Browser profile",
						source: "builtin",
						usage: "preparation",
					},
				],
				selectedProfileId: "builtin:web",
				selectionAvailable: true,
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
					rulesVersion: "3",
					direct: decision,
					container: decision,
					video: decision,
					audio: decision,
					selectedVideo: null,
					selectedAudio: null,
					output: JSON.parse(String(init.body)).output
						? { combinations: { "copy-copy": "supported" } }
						: null,
					warnings: [],
				});
			}
			return json({
				fileId: "file-1",
				sourceVersion: "version",
				rulesVersion: "3",
				container: "mp4",
				descriptionId: "a".repeat(64),
				output: null,
				video: null,
				audio: null,
				multipleTracks: false,
				queries: [],
			});
		}
		if (path === "/api/playback/sessions") {
			return json(
				{
					token: "session-token",
					generation: 1,
					sourceVersion: "version",
					file: file.file,
					plan: { mode: "direct", playbackUrl: file.playbackUrl },
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

function renderApp(path = "/", strict = false) {
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
	expect(screen.getByTestId("location").textContent).toBe("/");
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
		expect(screen.getByTestId("location").textContent).toBe("/"),
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
	rejectSave = false;
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await screen.findByRole("button", { name: "Scan library" });
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
	renderApp("/", true);
	await openFile();
	// Wait until the provider loads its source, including StrictMode effect replay.
	await waitFor(() =>
		expect(
			screen.getByLabelText("Video: Episode 01.mp4").getAttribute("src"),
		).toBe(file.playbackUrl),
	);
	const video = screen.getByLabelText("Video: Episode 01.mp4");
	expect(video.getAttribute("src")).toBe(file.playbackUrl);
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
	renderApp(path ?? "/");
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	expect(
		screen.getByRole("link", { name: "Parent directory" }).getAttribute("href"),
	).toBe("/");
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
	await screen.findByRole("link", { name: "Season 1" });
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
	const { router } = renderApp("/", true);
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

test("media errors recheck access and distinguish a deleted file from generic playback failure", async () => {
	renderApp();
	await openFile();
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	Object.defineProperty(video, "error", {
		value: { code: 3, message: "Decode failed" },
	});
	fireEvent.error(video);
	await screen.findByText("This media could not be played in this browser.", {
		selector: "[data-slot=toast-title]",
	});
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter(([path]) => path === "/api/files/file-1"),
		).toHaveLength(2),
	);
	fileError = true;
	fireEvent.error(video);
	await screen.findByText(
		"This file is no longer available. Scan the library again.",
		{ selector: "[data-slot=toast-title]" },
	);
});

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
						plan: { mode: "direct", playbackUrl: file.playbackUrl },
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
		expect(screen.getByTestId("location").textContent).toBe("/"),
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

test("file rows offer an icon copy button with tooltip without opening playback", async () => {
	const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
	renderApp();
	await screen.findByRole("link", { name: "Season 1" });
	expect(screen.queryByRole("button", { name: "Copy media link" })).toBeNull();
	fireEvent.click(screen.getByRole("link", { name: "Season 1" }));
	const button = await screen.findByRole("button", { name: "Copy media link" });
	fireEvent.focus(button);
	await waitFor(() =>
		expect(
			document.querySelector('[data-slot="tooltip-content"]')?.textContent,
		).toBe("Copy media link"),
	);
	expect(button.textContent).toBe("");
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
	await screen.findByText(
		"This browser cannot play the original file. Pre-transcode it from its folder before watching.",
	);
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(screen.queryByLabelText("Video: Episode 01.mp4")).toBeNull();
	const call = fetcher.mock.calls.find(
		([path, init]) =>
			path === "/api/files/file-1/compatibility" && init?.method === "POST",
	);
	expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
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
		if (String(input).startsWith("/api/files/file-1/compatibility"))
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

test("unsupported file uses a ready transcode automatically and the task monitor persists across navigation", async () => {
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
			playbackUrl: "/api/prepared-media/artifact",
			sizeBytes: 100,
		},
	];
	renderApp("/files/file-1");
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	await waitFor(() =>
		expect(video.getAttribute("src")).toBe("/api/prepared-media/artifact"),
	);
	expect(screen.queryByRole("dialog")).toBeNull();
	const monitor = screen.getByRole("complementary", {
		name: "Transcoding tasks",
	});
	fireEvent.click(
		within(monitor).getByRole("button", { name: /Transcoding tasks/ }),
	);
	fireEvent.click(screen.getByRole("link", { name: "Library" }));
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toBe("/"),
	);
	expect(screen.getByRole("complementary", { name: "Transcoding tasks" })).toBe(
		monitor,
	);
	expect(
		within(monitor)
			.getByRole("button", { name: /Transcoding tasks/ })
			.getAttribute("aria-expanded"),
	).toBe("false");
	expect(screen.queryByRole("link", { name: "Media preparation" })).toBeNull();
	expect(
		fetcher.mock.calls.some(
			([url, init]) =>
				String(url).includes("/preparations") && init?.method === "POST",
		),
	).toBe(false);
});
