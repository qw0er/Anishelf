// @vitest-environment happy-dom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
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
	ScanState,
	SettingsResponse,
} from "../src/api/contracts.js";
import { libraryRoute } from "../src/routes/library.js";

const runningScan: ScanState = {
	id: "scan-1",
	status: "running",
	startedAt: "2026-09-29T00:00:00.000Z",
	finishedAt: null,
	visitedCount: 2,
	matchedCount: 1,
	warnings: { count: 0, messages: [] },
};
const completedScan: ScanState = {
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
let settings: SettingsResponse;

function json(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

beforeEach(() => {
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
	settings = { resourceRoot: "/media" };
	fetcher.mockReset();
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path === "/api/settings") {
			if (init?.method === "PUT") {
				settings = JSON.parse(String(init.body)) as SettingsResponse;
				library = {
					...library,
					ready: true,
					scan: null,
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
	vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
	vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
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
	const app = <RouterProvider router={router} />;
	return { ...render(strict ? <StrictMode>{app}</StrictMode> : app), router };
}

async function openFile() {
	fireEvent.click(await screen.findByRole("link", { name: "Season 1" }));
	fireEvent.click(await screen.findByRole("link", { name: "Episode 01.mp4" }));
}

test("first-run setup saves the server directory and enables a manual scan", async () => {
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
	const input = (await screen.findByLabelText(
		"Resource directory path",
	)) as HTMLInputElement;
	expect(input.value).toBe("");
	expect(
		(screen.getByRole("button", { name: "Scan library" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	fireEvent.change(input, { target: { value: "/media/中文 videos" } });
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await screen.findByText("Saved resource directory: /media/中文 videos");
	expect(
		screen.queryByText("Set a resource directory to start using the library."),
	).toBeNull();
	expect(
		(screen.getByRole("button", { name: "Scan library" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
	expect(
		fetcher.mock.calls.some(
			([path, init]) =>
				path === "/api/settings" &&
				init?.method === "PUT" &&
				init.body === JSON.stringify({ resourceRoot: "/media/中文 videos" }),
		),
	).toBe(true);
	expect(
		fetcher.mock.calls.some(([path]) => path === "/api/library/scan"),
	).toBe(false);
	fireEvent.click(screen.getByRole("button", { name: "Scan library" }));
	await screen.findByText("Scan: running");
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
	const input = screen.getByLabelText("Resource directory path");
	fireEvent.change(input, { target: { value: "/new/media" } });
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await screen.findByText("Saved resource directory: /new/media");
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toBe("/"),
	);
	expect(screen.queryByLabelText("Video: Episode 01.mp4")).toBeNull();
	expect(video.getAttribute("src")).toBeNull();
	expect(screen.queryByRole("link", { name: "Season 1" })).toBeNull();
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
	renderApp();
	const input = (await screen.findByLabelText(
		"Resource directory path",
	)) as HTMLInputElement;
	fireEvent.change(input, { target: { value: "/new/media" } });
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await screen.findByText("Settings could not be saved.");
	expect(input.value).toBe("/new/media");
	expect(screen.getByRole("link", { name: "Season 1" })).toBeTruthy();
	rejectSave = false;
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await screen.findByText("Saved resource directory: /new/media");
	expect(screen.queryByText("Settings could not be saved.")).toBeNull();
});

test("navigates directories, opens media, and returns to the original directory with media unloaded", async () => {
	renderApp("/", true);
	await openFile();
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	expect(video.getAttribute("src")).toBe(file.playbackUrl);
	expect(video.hasAttribute("controls")).toBe(true);
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

test("scan status updates do not unload a playing file", async () => {
	renderApp();
	await openFile();
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	fireEvent.click(screen.getByRole("button", { name: "Scan library" }));
	await screen.findByText("Scan: running");
	expect(screen.getByLabelText("Video: Episode 01.mp4")).toBe(video);
	expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
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
	await screen.findByText("The resource directory is unavailable.");
	expect(screen.getByRole("link", { name: "Episode 01.mp4" })).toBeTruthy();
	expect(screen.getByTestId("location").textContent).toBe(
		"/directories/season-1",
	);
	rejectScan = false;
	fireEvent.click(screen.getByRole("button", { name: "Scan library" }));
	await screen.findByText("Scan: running");
	expect(
		screen.queryByText("The resource directory is unavailable."),
	).toBeNull();
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
	fireEvent.error(video);
	await screen.findByText("This media could not be played in this browser.");
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter(([path]) => path === "/api/files/file-1"),
		).toHaveLength(2),
	);
	fileError = true;
	fireEvent.error(video);
	await screen.findByText(
		"This file is no longer available. Scan the library again.",
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
