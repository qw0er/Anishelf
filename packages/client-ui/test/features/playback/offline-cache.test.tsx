// @vitest-environment happy-dom

import type {
	OfflineCacheEntry,
	OfflineCacheHost,
} from "@anishelf/contracts/offline-cache";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { OfflineCachePage } from "../../../src/features/playback/offline/cache-page.js";
import { OfflineCacheProvider } from "../../../src/features/playback/offline/state.js";
import { toast } from "../../../src/shared/components/ui/toast.js";
import i18n from "../../../src/shared/i18n.js";

const ready: OfflineCacheEntry = {
	id: "ready",
	server: "local",
	fileId: "one",
	sourceVersion: "v1",
	name: "First.mkv",
	episodes: [
		{
			workId: "work",
			workTitle: "Work title",
			number: "1",
			label: "Episode 1",
		},
	],
	status: "ready",
	percent: 100,
	sizeBytes: 1000,
	failure: null,
	playing: false,
};
const failed: OfflineCacheEntry = {
	...ready,
	id: "failed",
	fileId: "two",
	name: "Second.mkv",
	episodes: [],
	status: "failed",
	percent: null,
	sizeBytes: 0,
	failure: "download",
};

function setup(entries: OfflineCacheEntry[]) {
	let listener: Parameters<OfflineCacheHost["subscribe"]>[0] | undefined;
	const host = {
		list: vi.fn(async () => entries),
		subscribe: vi.fn((callback) => {
			listener = callback;
			return () => {
				listener = undefined;
			};
		}),
		start: vi.fn(async () => {}),
		cancel: vi.fn(async () => {}),
		retry: vi.fn<OfflineCacheHost["retry"]>(async () => {}),
		remove: vi.fn(async () => {}),
		open: vi.fn(async () => null),
		savePosition: vi.fn(async () => {}),
		close: vi.fn(async () => {}),
	} satisfies OfflineCacheHost;
	render(
		<MemoryRouter initialEntries={["/offline-cache"]}>
			<OfflineCacheProvider
				cache={{ host, server: "local" }}
				navigate={vi.fn()}
			>
				<OfflineCachePage />
			</OfflineCacheProvider>
		</MemoryRouter>,
	);
	return {
		host,
		publish(entry: OfflineCacheEntry) {
			act(() => listener?.(entry, entry.id));
		},
	};
}

beforeEach(async () => {
	await i18n.changeLanguage("en");
	vi.spyOn(toast, "add").mockReturnValue("offline-cache-test");
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

test("combines search and status, preserves global totals and offers a way to clear a search", async () => {
	setup([ready, failed]);
	await screen.findByText("First.mkv");
	fireEvent.change(screen.getByRole("searchbox"), {
		target: { value: "work title" },
	});
	expect(screen.getByRole("link", { name: "Play" }).getAttribute("href")).toBe(
		"/offline-cache/ready?search=work+title",
	);
	expect(screen.queryByText("Second.mkv")).toBeNull();
	fireEvent.change(screen.getByRole("combobox"), {
		target: { value: "failed" },
	});
	expect(
		screen.getByRole("heading", { name: "No matching videos" }),
	).toBeTruthy();
	expect(screen.getByText(/1 cached file/)).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
	expect(screen.getByText("First.mkv")).toBeTruthy();
	expect(screen.getByText("Second.mkv")).toBeTruthy();
});

test("isolates busy feedback for simultaneous row actions", async () => {
	const { host } = setup([
		failed,
		{ ...failed, id: "third", name: "Third.mkv" },
	]);
	const second = Promise.withResolvers<void>();
	const third = Promise.withResolvers<void>();
	host.retry
		.mockReturnValueOnce(second.promise)
		.mockReturnValueOnce(third.promise);
	await screen.findByText("Third.mkv");
	const retryButtons = screen.getAllByRole("button", { name: "Retry" });
	const [secondButton, thirdButton] = retryButtons;
	if (!secondButton || !thirdButton) throw new Error("Missing retry buttons.");
	fireEvent.click(secondButton);
	fireEvent.click(thirdButton);
	expect(secondButton.getAttribute("aria-busy")).toBe("true");
	expect(thirdButton.getAttribute("aria-busy")).toBe("true");
	await act(async () => second.resolve());
	expect(secondButton.getAttribute("aria-busy")).toBe("false");
	expect(thirdButton.getAttribute("aria-busy")).toBe("true");
	fireEvent.click(thirdButton);
	expect(host.retry).toHaveBeenCalledTimes(2);
	await act(async () => third.resolve());
	expect(thirdButton.getAttribute("aria-busy")).toBe("false");
});

test("retries transfer failures from their toast and preserves the list on refresh failure", async () => {
	const { host, publish } = setup([
		ready,
		{ ...failed, status: "downloading" },
	]);
	await screen.findByText("Second.mkv");
	publish(failed);
	const failure = vi
		.mocked(toast.add)
		.mock.calls.find(([item]) => item.title === "Could not cache video")?.[0];
	expect(failure?.actionProps?.children).toBe("Retry");
	const retry = failure?.actionProps?.onClick;
	if (!retry) throw new Error("Missing notification retry.");
	// Trigger the shared action using the notification's own click handler.
	act(() => retry({} as Parameters<typeof retry>[0]));
	await waitFor(() => expect(host.retry).toHaveBeenCalledWith(failed.id));

	host.list.mockRejectedValueOnce(new Error("Read failed."));
	fireEvent.click(
		screen.getByRole("button", { name: "Refresh offline cache" }),
	);
	await waitFor(() =>
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "offline-cache-list",
				type: "error",
			}),
		),
	);
	const row = screen.getByText("First.mkv").closest("li");
	if (!row) throw new Error("The ready row disappeared during refresh.");
	expect(within(row).getByRole("link", { name: "Play" })).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
});
