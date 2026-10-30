// @vitest-environment happy-dom

import { expect, test } from "vitest";
import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "../../support/query-test-utils.js";
import { setupAppTest } from "../support/lifecycle.js";
import { openFile, renderApp } from "../support/render-app.js";
import { appFixture, fetcher, file, json } from "../support/state.js";

setupAppTest();

test("Files searches the current directory and sorts files while keeping directories first", async () => {
	const directory = appFixture.directories.get("season-1");
	if (!directory) throw new Error("Missing test directory");
	appFixture.directories.set("season-1", {
		...directory,
		children: [
			{ kind: "directory", id: "sub", parentId: "season-1", name: "Folder" },
			{
				...file.file,
				id: "a",
				name: "Episode 2.mp4",
				sizeBytes: 200,
				modifiedAt: "2026-01-02T00:00:00.000Z",
			},
			{
				...file.file,
				id: "b",
				name: "Episode 10.mp4",
				sizeBytes: 100,
				modifiedAt: "2026-01-01T00:00:00.000Z",
			},
		],
	});
	appFixture.directories.set("sub", {
		directory: {
			kind: "directory",
			id: "sub",
			parentId: "season-1",
			name: "Folder",
		},
		children: [
			{
				...file.file,
				id: "nested",
				parentId: "sub",
				name: "Nested episode.mp4",
			},
		],
	});
	renderApp("/directories/season-1");
	await screen.findByRole("link", { name: "Episode 2.mp4" });
	const names = () =>
		Array.from(
			document.querySelectorAll("li[id^='file-'] a[aria-label]"),
			(link) => link.getAttribute("aria-label"),
		);
	expect(names()).toEqual(["Folder", "Episode 2.mp4", "Episode 10.mp4"]);
	const sort = screen.getByLabelText("Sort files");
	fireEvent.change(sort, { target: { value: "size-asc" } });
	expect(names()).toEqual(["Folder", "Episode 10.mp4", "Episode 2.mp4"]);
	fireEvent.change(sort, { target: { value: "modified-desc" } });
	expect(names()).toEqual(["Folder", "Episode 2.mp4", "Episode 10.mp4"]);
	fireEvent.change(sort, { target: { value: "name-desc" } });
	expect(names()).toEqual(["Folder", "Episode 10.mp4", "Episode 2.mp4"]);
	fireEvent.change(sort, { target: { value: "default" } });
	expect(names()).toEqual(["Folder", "Episode 2.mp4", "Episode 10.mp4"]);
	const search = screen.getByLabelText(
		"Search names in this directory and subfolders",
	);
	fireEvent.change(search, { target: { value: "EPISODE 10" } });
	await waitFor(() => expect(names()).toEqual(["Episode 10.mp4"]));
	fireEvent.change(search, { target: { value: "nested" } });
	const nested = await screen.findByRole("link", {
		name: "Nested episode.mp4",
	});
	expect(nested.getAttribute("href")).toContain("sub");
	expect(within(nested).getByText("Folder")).toBeTruthy();
	fireEvent.change(search, { target: { value: "missing" } });
	expect(await screen.findByText("No names match your search.")).toBeTruthy();
	fireEvent.change(search, { target: { value: "Episode" } });
	fireEvent.change(sort, { target: { value: "size-desc" } });
	fireEvent.click(screen.getByRole("link", { name: "Parent directory" }));
	await screen.findByText("Directory: media");
	expect(
		(
			screen.getByLabelText(
				"Search names in this directory and subfolders",
			) as HTMLInputElement
		).value,
	).toBe("");
	expect((screen.getByLabelText("Sort files") as HTMLSelectElement).value).toBe(
		"default",
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
	expect(screen.getByText("Directory: Season 1")).toBeTruthy();
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

test("a missing file shows safe feedback and can be retried", async () => {
	appFixture.fileError = true;
	renderApp();
	await openFile();
	await screen.findByText(
		"This file is no longer available. Scan the library again.",
	);
	expect(screen.queryByLabelText("Video: Episode 01.mp4")).toBeNull();
	appFixture.fileError = false;
	fireEvent.click(screen.getByRole("button", { name: "Retry file" }));
	await screen.findByLabelText("Video: Episode 01.mp4");
});

test.each([false, true])(
	"media errors remain scoped to the selected asset with missing=%s",
	async (missing) => {
		renderApp();
		await openFile();
		const video = await screen.findByLabelText("Video: Episode 01.mp4");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		appFixture.fileError = missing;
		Object.defineProperty(video, "error", {
			value: { code: 3, message: "Decode failed" },
		});
		fireEvent.error(video);
		await screen.findByText(
			"This media version could not be decoded. Try another version or prepare a new copy.",
			{ selector: "[data-slot=toast-title]" },
		);
		await waitFor(() =>
			expect(
				fetcher.mock.calls.filter(([path]) => path === "/api/files/file-1"),
			).toHaveLength(1),
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
	appFixture.directories.delete("season-1");
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByText("The resource was not found.");
	fireEvent.click(screen.getByRole("link", { name: "Go to root" }));
	await screen.findByRole("link", { name: "Season 1" });
});

test("Files shows root entries and an offline warning while healthy roots remain browsable", async () => {
	appFixture.settings = { resourceRoots: ["/disk-a/media", "/disk-b/media"] };
	appFixture.library = {
		...appFixture.library,
		roots: [
			{
				id: "scope-a",
				name: "Disk A",
				available: false,
				error: { code: "RESOURCE_ROOT_UNAVAILABLE", message: "Unavailable" },
			},
			{ id: "scope-b", name: "Disk B", available: true, error: null },
		],
	};
	appFixture.directories.set("root", {
		directory: {
			kind: "directory",
			id: "root",
			parentId: null,
			name: "Resources",
		},
		children: [
			{ kind: "directory", id: "disk-a", parentId: "root", name: "Disk A" },
			{ kind: "directory", id: "disk-b", parentId: "root", name: "Disk B" },
		],
	});
	appFixture.directories.set("disk-b", {
		directory: {
			kind: "directory",
			id: "disk-b",
			parentId: "root",
			name: "Disk B",
		},
		children: [{ ...file.file, parentId: "disk-b" }],
	});
	renderApp();
	await screen.findByText(
		"Disk A is unavailable. Its previous index is retained; other directories can still be used.",
	);
	fireEvent.click(await screen.findByRole("link", { name: "Disk B" }));
	await screen.findByRole("link", { name: "Episode 01.mp4" });
	expect(screen.getByTestId("location").textContent).toBe(
		"/directories/disk-b",
	);
});
