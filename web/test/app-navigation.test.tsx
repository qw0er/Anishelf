// @vitest-environment happy-dom
import { preparationConstraints } from "@anishelf/backend/contracts/defaults";
import { expect, test, vi } from "vitest";
import { toast } from "../src/shared/components/ui/toast.js";
import { act, fireEvent, screen, waitFor, within } from "./query-test-utils.js";
import {
	appFixture,
	completedScan,
	fetcher,
	file,
	json,
	openFile,
	renderApp,
	runningScan,
} from "./support/app-fixture.js";

test("first-run setup saves the server directory and shows the automatic scan", async () => {
	appFixture.settings = { resourceRoots: [] };
	appFixture.library = {
		...appFixture.library,
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
		"New resource directory path",
	)) as HTMLInputElement;
	expect(input.value).toBe("");
	fireEvent.change(input, { target: { value: "/media/中文 videos" } });
	fireEvent.click(screen.getByRole("button", { name: "Add directory" }));
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
						resourceRoots: ["/media/中文 videos"],
						transcodeCacheBudgetGiB:
							preparationConstraints.defaultCacheBudgetGiB,
					}),
		),
	).toBe(true);
	expect(
		fetcher.mock.calls.some(([path]) => path === "/api/library/scan"),
	).toBe(false);
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Scan library" })
				.getAttribute("aria-busy"),
		).toBe("true"),
	);
	fireEvent.click(screen.getByRole("link", { name: "Settings" }));
	expect(
		(
			screen.getByRole("button", {
				name: "Save directories",
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
	const input = await screen.findByLabelText("New resource directory path");
	fireEvent.click(screen.getByRole("button", { name: "Delete /media" }));
	fireEvent.change(input, { target: { value: "/new/media" } });
	fireEvent.click(screen.getByRole("button", { name: "Add directory" }));
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toBe(
			"/directories/root",
		),
	);
	expect(screen.queryByLabelText("Video: Episode 01.mp4")).toBeNull();
	expect(video.getAttribute("src")).toBeNull();
	expect(screen.queryByRole("link", { name: "Season 1" })).toBeNull();
	expect(
		screen
			.getByRole("button", { name: "Scan library" })
			.getAttribute("aria-busy"),
	).toBe("true");
});

test("a failed settings save retains the draft list and supports a retry", async () => {
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
		"New resource directory path",
	)) as HTMLInputElement;
	fireEvent.click(screen.getByRole("button", { name: "Delete /media" }));
	fireEvent.change(input, { target: { value: "/new/media" } });
	fireEvent.click(screen.getByRole("button", { name: "Add directory" }));
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await screen.findByText("Settings could not be saved.", {
		selector: "[data-slot=toast-title]",
	});
	expect(within(screen.getByRole("main")).queryByRole("alert")).toBeNull();
	expect(
		screen.getByRole("button", { name: "Delete /new/media" }),
	).toBeTruthy();
	expect(screen.getByTestId("location").textContent).toBe("/settings");
	// The error toast appears before the fetcher returns to idle. Wait until
	// the form is usable so disabled controls are included in the retry.
	await waitFor(() => {
		expect(input.disabled).toBe(false);
		expect(
			(
				screen.getByRole("button", {
					name: "Save directories",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
	});
	rejectSave = false;
	fireEvent.click(screen.getByRole("button", { name: "Save directories" }));
	await screen.findByRole("button", { name: "Scan library" });
	expect(
		fetcher.mock.calls.filter(
			([path, init]) => path === "/api/settings" && init?.method === "PUT",
		),
	).toHaveLength(2);
	expect(appFixture.settings.resourceRoots).toEqual(["/new/media"]);
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

test("starts scanning, refreshes publications, and keeps lightweight status polling", async () => {
	vi.useFakeTimers();
	appFixture.library = { ...appFixture.library, revision: 0, scan: null };
	const root = appFixture.directories.get("root");
	if (!root) throw new Error("Missing fixture");
	appFixture.directories.set("root", { ...root, children: [] });
	await act(async () => {
		renderApp();
	});
	expect(
		screen
			.getByRole("button", { name: "Scan library" })
			.getAttribute("aria-busy"),
	).toBe("false");
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Scan library" }));
	});
	expect(
		screen
			.getByRole("button", { name: "Scan library" })
			.getAttribute("aria-busy"),
	).toBe("true");
	expect(
		(screen.getByRole("button", { name: "Scan library" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(
		fetcher.mock.calls.some(([path]) => path === "/api/library/scan"),
	).toBe(true);
	appFixture.library = {
		...appFixture.library,
		scan: { ...runningScan, visitedCount: 3 },
	};
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1000);
	});
	expect(
		screen
			.getByRole("button", { name: "Scan library" })
			.getAttribute("aria-busy"),
	).toBe("true");
	appFixture.directories.set("root", root);
	appFixture.library = {
		...appFixture.library,
		revision: 1,
		scan: {
			...completedScan,
			warnings: { count: 1, messages: ["An unreadable file was skipped."] },
		},
	};
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1000);
	});
	expect(
		screen
			.getByRole("button", { name: "Scan library" })
			.getAttribute("aria-busy"),
	).toBe("false");
	expect(
		screen.getByText("Library scan completed with 1 warning."),
	).toBeTruthy();
	expect(screen.getByText(/An unreadable file was skipped\./)).toBeTruthy();
	expect(screen.getByRole("link", { name: "Season 1" })).toBeTruthy();
	expect(
		(screen.getByRole("button", { name: "Scan library" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
	const calls = fetcher.mock.calls.length;
	await act(async () => {
		await vi.advanceTimersByTimeAsync(5000);
	});
	expect(fetcher.mock.calls.length).toBeGreaterThan(calls);
});

test("scan completion notifies once across StrictMode and repeated refreshes", async () => {
	const notify = vi.spyOn(toast, "add");
	appFixture.library = { ...appFixture.library, scan: runningScan };
	const { router } = renderApp("/directories/root", true);
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Scan library" })
				.getAttribute("aria-busy"),
		).toBe("true"),
	);
	expect(notify).not.toHaveBeenCalled();
	appFixture.library = {
		...appFixture.library,
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
	await screen.findByText("Library scan completed with 1 warning.");
	expect(notify).toHaveBeenCalledTimes(1);
	await act(async () => {
		await router.revalidate();
	});
	expect(notify).toHaveBeenCalledTimes(1);
	expect(
		screen.getByText(/A video file could not be read and was skipped\./),
	).toBeTruthy();
});

test("scan status updates do not unload a playing file", async () => {
	renderApp();
	fireEvent.click(await screen.findByRole("link", { name: "Season 1" }));
	fireEvent.click(screen.getByRole("button", { name: "Scan library" }));
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Scan library" })
				.getAttribute("aria-busy"),
		).toBe("true"),
	);
	fireEvent.click(await screen.findByRole("link", { name: "Episode 01.mp4" }));
	const video = await screen.findByLabelText("Video: Episode 01.mp4");
	expect(screen.queryByRole("button", { name: "Scan library" })).toBeNull();
	const libraryCalls = fetcher.mock.calls.filter(
		([path]) => path === "/api/library",
	).length;
	appFixture.library = { ...appFixture.library, scan: completedScan };
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
	appFixture.library = { ...appFixture.library, scan: runningScan };
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
		resolvePoll?.(json({ ...appFixture.library, scan: completedScan }));
	});
	expect(
		screen
			.getByRole("button", { name: "Scan library" })
			.getAttribute("aria-busy"),
	).toBe("false");
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
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Scan library" })
				.getAttribute("aria-busy"),
		).toBe("true"),
	);
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
	expect(
		(screen.getByRole("button", { name: "Scan library" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	disconnected = false;
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Scan library" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	expect(screen.queryByRole("alert")).toBeNull();
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
	"media errors recheck access with missing=%s",
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
	appFixture.directories.delete("season-1");
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByText("The resource was not found.");
	fireEvent.click(screen.getByRole("link", { name: "Go to root" }));
	await screen.findByRole("link", { name: "Season 1" });
});

test("an unavailable library disables scanning, and refresh recovers scanning", async () => {
	appFixture.library = {
		...appFixture.library,
		ready: false,
		stale: true,
		error: {
			code: "RESOURCE_ROOT_UNAVAILABLE",
			message: "The resource directory is unavailable.",
		},
	};
	renderApp();
	await screen.findByText("Showing the previous scan results.");
	expect(
		(screen.getByRole("button", { name: "Scan library" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(screen.getByText("Showing the previous scan results.")).toBeTruthy();
	appFixture.library = {
		...appFixture.library,
		ready: true,
		stale: false,
		error: null,
	};
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

test("settings saves the resource root without a scan interval", async () => {
	renderApp("/settings");
	const path = await screen.findByLabelText("New resource directory path");
	expect(
		screen.queryByLabelText("Automatic scan interval (minutes)"),
	).toBeNull();
	fireEvent.submit(path.closest("form") as HTMLFormElement);
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toBe(
			"/directories/root",
		),
	);
	expect(
		fetcher.mock.calls.some(
			([url, init]) =>
				url === "/api/settings" &&
				init?.method === "PUT" &&
				!Object.hasOwn(JSON.parse(String(init.body)), "scanIntervalMinutes"),
		),
	).toBe(true);
});

test("settings use shared cache constraints without requesting client configuration", async () => {
	renderApp("/settings");
	const budget = await screen.findByLabelText<HTMLInputElement>(
		"Transcode cache budget (GiB)",
	);
	expect(budget.min).toBe("1");
	expect(
		fetcher.mock.calls.some(([url]) => String(url).includes("client-config")),
	).toBe(false);
});

test("settings save the edited directory list", async () => {
	renderApp("/settings");
	const input = await screen.findByLabelText("New resource directory path");
	fireEvent.click(screen.getByRole("button", { name: "Delete /media" }));
	fireEvent.change(input, { target: { value: "/disk-a/media" } });
	fireEvent.click(screen.getByRole("button", { name: "Add directory" }));
	fireEvent.change(input, { target: { value: "/disk-b/中文 videos" } });
	fireEvent.keyDown(input, { key: "Enter" });
	expect(
		within(
			screen.getByRole("list", { name: "Resource directory paths" }),
		).getAllByRole("listitem"),
	).toHaveLength(2);
	expect(
		fetcher.mock.calls.some(
			([path, init]) => path === "/api/settings" && init?.method === "PUT",
		),
	).toBe(false);
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await waitFor(() =>
		expect(appFixture.settings.resourceRoots).toEqual([
			"/disk-a/media",
			"/disk-b/中文 videos",
		]),
	);
	await screen.findByRole("button", { name: "Scan library" });
	expect(screen.getByTestId("location").textContent).toBe("/directories/root");
});

test("duplicate paths stay editable without sending a settings request", async () => {
	renderApp("/settings");
	const input = await screen.findByLabelText("New resource directory path");
	fireEvent.change(input, { target: { value: "/media" } });
	fireEvent.click(screen.getByRole("button", { name: "Add directory" }));
	await screen.findByText("This directory is already in the list.");
	expect(
		fetcher.mock.calls.some(
			([path, init]) => path === "/api/settings" && init?.method === "PUT",
		),
	).toBe(false);
	expect((input as HTMLInputElement).value).toBe("/media");
	expect(
		within(
			screen.getByRole("list", { name: "Resource directory paths" }),
		).getAllByRole("listitem"),
	).toHaveLength(1);
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

test("clearing the path list saves setup mode", async () => {
	renderApp("/settings");
	const input = await screen.findByLabelText("New resource directory path");
	fireEvent.click(screen.getByRole("button", { name: "Delete /media" }));
	await screen.findByText("No resource directories added.");
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	await waitFor(() => expect(appFixture.settings.resourceRoots).toEqual([]));
	await screen.findByRole("button", { name: "Scan library" });
	expect(
		(screen.getByRole("button", { name: "Scan library" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
});
