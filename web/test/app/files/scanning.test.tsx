// @vitest-environment happy-dom

import { expect, test, vi } from "vitest";
import { toast } from "../../../src/shared/components/ui/toast.js";
import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "../../support/query-test-utils.js";
import { setupAppTest } from "../support/lifecycle.js";
import { renderApp } from "../support/render-app.js";
import {
	appFixture,
	completedScan,
	fetcher,
	json,
	runningScan,
} from "../support/state.js";

setupAppTest();

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
