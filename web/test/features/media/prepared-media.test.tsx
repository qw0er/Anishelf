// @vitest-environment happy-dom

import {
	MemoryRouter,
	Outlet,
	Route,
	Routes,
	useLocation,
	useOutletContext,
} from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AppHeader from "../../../src/app/components/app-header.js";
import { FilesLayout } from "../../../src/app/components/files-layout.js";
import * as api from "../../../src/features/media/preparation/api.js";
import { PreparedMediaPage } from "../../../src/features/media/preparation/components/prepared-media-page.js";
import type {
	PreparedMediaItem,
	PreparedMediaList,
} from "../../../src/shared/api/contracts.js";
import { QueryScope } from "../../../src/shared/api/queries.js";
import { queryClient } from "../../../src/shared/api/query-client.js";
import { toast } from "../../../src/shared/components/ui/toast.js";
import i18n from "../../../src/shared/i18n.js";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../support/query-test-utils.js";

const one: PreparedMediaItem = {
	id: "a".repeat(64),
	fileId: "one",
	sourceVersion: "v1",
	filename: "First.mkv",
	sourcePath: "Season/First.mkv",
	profileName: "Balanced",
	audioStreamIndices: [1],
	sizeBytes: 1000,
	createdAtMs: 1000,
	status: "ready",
	deleteBlockedReason: null,
};
const two: PreparedMediaItem = {
	...one,
	id: "b".repeat(64),
	fileId: "two",
	filename: "Second.mkv",
	status: "unknown",
};
const busy: PreparedMediaItem = {
	...one,
	id: "c".repeat(64),
	filename: "Playing.mkv",
	deleteBlockedReason: "in-use",
};
let listing: PreparedMediaList;
const onDeleted = vi.fn();
beforeEach(async () => {
	await i18n.changeLanguage("en");
	vi.spyOn(toast, "add").mockReturnValue("delete-notification");
	listing = {
		items: [one, two, busy],
		total: 3,
		page: 1,
		pageSize: 50,
		usage: {
			count: 3,
			copyBytes: 3000,
			retainedBytes: 4000,
			budgetBytes: 10000,
		},
	};
	vi.spyOn(api, "getPreparedMedia").mockImplementation(async () =>
		structuredClone(listing),
	);
	vi.spyOn(api, "deletePreparedMediaBatch").mockResolvedValue({
		results: [{ id: one.id, error: null }],
	});
	onDeleted.mockClear();
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
function Location() {
	const location = useLocation();
	return (
		<output aria-label="Location">
			{location.pathname}
			{location.search}
		</output>
	);
}
function show(path = "/prepared-media") {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<PreparedMediaPage onDeleted={onDeleted} />
			<Location />
		</MemoryRouter>,
	);
}

test("lists copy metadata and usage, disables unverified playback and busy deletion, and links originals", async () => {
	show();
	await screen.findByText("First.mkv");
	expect(screen.getByText("3 copies · 3 KB / 10 KB budget")).toBeTruthy();
	expect(screen.getByText(/Total budget usage: 4 KB/)).toBeTruthy();
	const first = screen.getByText("First.mkv").closest("li");
	if (!first) throw new Error("Missing row");
	expect(
		within(first).getByRole("link", { name: "Play" }).getAttribute("href"),
	).toContain(`asset=${one.id}`);
	expect(
		within(first)
			.getByRole("link", { name: "Show original" })
			.getAttribute("href"),
	).toBe("/files/one/locate");
	const unknown = screen.getByText("Second.mkv").closest("li");
	if (!unknown) throw new Error("Missing row");
	expect(
		(
			within(unknown).getByRole("button", {
				name: "Play",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	expect(screen.getByText(/In use; stop playback/)).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Select" }));
	expect(
		screen
			.getByRole("checkbox", { name: "Select Playing.mkv" })
			.getAttribute("aria-disabled"),
	).toBe("true");
});

test("search, availability, sort and page are sent to the server and clear selection", async () => {
	listing.total = 51;
	show();
	await screen.findByText("First.mkv");
	fireEvent.click(screen.getByRole("button", { name: "Select" }));
	fireEvent.click(screen.getByRole("checkbox", { name: "Select this page" }));
	expect(
		(
			screen.getByRole("button", {
				name: "Delete selected (2)",
			}) as HTMLButtonElement
		).disabled,
	).toBe(false);
	fireEvent.change(
		screen.getByRole("searchbox", { name: "Search filename or path" }),
		{ target: { value: "First" } },
	);
	await waitFor(() =>
		expect(api.getPreparedMedia).toHaveBeenLastCalledWith(
			expect.objectContaining({ search: "First", page: "1" }),
			expect.anything(),
		),
	);
	expect(
		(
			screen.getByRole("button", {
				name: "Delete selected (0)",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	fireEvent.change(screen.getByRole("combobox", { name: "Availability" }), {
		target: { value: "ready" },
	});
	fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
		target: { value: "size" },
	});
	await waitFor(() =>
		expect(api.getPreparedMedia).toHaveBeenLastCalledWith(
			expect.objectContaining({ status: "ready", sort: "size" }),
			expect.anything(),
		),
	);
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Next" }));
	await waitFor(() =>
		expect(api.getPreparedMedia).toHaveBeenLastCalledWith(
			expect.objectContaining({ page: "2" }),
			expect.anything(),
		),
	);
	expect(screen.getByLabelText("Location").textContent).toContain("page=2");
});

test("confirms bytes before batch deletion, retains partial failures and retries with cache refresh", async () => {
	const invalidate = vi.spyOn(queryClient, "invalidateQueries");
	vi.mocked(api.deletePreparedMediaBatch).mockResolvedValueOnce({
		results: [
			{ id: one.id, error: null },
			{ id: two.id, error: "RESOURCE_WRITE_FAILED" },
		],
	});
	show();
	await screen.findByText("First.mkv");
	fireEvent.click(screen.getByRole("button", { name: "Select" }));
	fireEvent.click(screen.getByRole("checkbox", { name: "Select this page" }));
	fireEvent.click(screen.getByRole("button", { name: "Delete selected (2)" }));
	const dialog = await screen.findByRole("dialog");
	expect(
		within(dialog).getByText(/Delete 2 copies and free approximately 2 KB/),
	).toBeTruthy();
	expect(
		within(dialog).getByText(
			/Automatic preparation may create these copies again/,
		),
	).toBeTruthy();
	expect(api.deletePreparedMediaBatch).not.toHaveBeenCalled();
	listing.items = [two, busy];
	listing.usage.count = 2;
	fireEvent.click(within(dialog).getByRole("button", { name: "Delete copy" }));
	await waitFor(() =>
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "warning",
				title: "Deleted: 1 · Failed: 1",
				timeout: 0,
			}),
		),
	);
	expect(screen.queryByText("Deleted: 1 · Failed: 1")).toBeNull();
	const notification = vi.mocked(toast.add).mock.calls.at(-1)?.[0];
	render(
		<>
			{notification?.description}
			<button type="button" {...notification?.actionProps} />
		</>,
	);
	expect(screen.getByText(/Second.mkv:/)).toBeTruthy();
	expect(api.deletePreparedMediaBatch).toHaveBeenCalledWith(
		[one.id, two.id],
		expect.anything(),
	);
	expect(onDeleted).toHaveBeenCalledOnce();
	expect(invalidate).toHaveBeenCalledWith({ queryKey: ["preparations"] });
	vi.mocked(api.deletePreparedMediaBatch).mockResolvedValueOnce({
		results: [{ id: two.id, error: null }],
	});
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	const retry = await screen.findByRole("dialog");
	fireEvent.click(within(retry).getByRole("button", { name: "Delete copy" }));
	await waitFor(() =>
		expect(toast.add).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: "success", title: "Deleted 1 copy" }),
		),
	);
	expect(screen.queryByText("Deleted: 1 · Failed: 0")).toBeNull();
	expect(api.deletePreparedMediaBatch).toHaveBeenLastCalledWith(
		[two.id],
		expect.anything(),
	);
});

test("single deletion retains the confirmation and chosen input after a request failure", async () => {
	vi.mocked(api.deletePreparedMediaBatch).mockRejectedValueOnce(
		new Error("offline"),
	);
	show();
	const first = (await screen.findByText("First.mkv")).closest("li");
	if (!first) throw new Error("Missing row");
	fireEvent.click(within(first).getByRole("button", { name: "Delete copy" }));
	const dialog = await screen.findByRole("dialog");
	fireEvent.click(within(dialog).getByRole("button", { name: "Delete copy" }));
	await waitFor(() =>
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "error",
				title: "Could not delete 1 copy",
			}),
		),
	);
	expect(within(dialog).queryByRole("alert")).toBeNull();
	expect(within(dialog).getByText(/Delete 1 copies/)).toBeTruthy();
	fireEvent.click(within(dialog).getByRole("button", { name: "Delete copy" }));
	await waitFor(() =>
		expect(toast.add).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: "success", title: "Deleted 1 copy" }),
		),
	);
	expect(screen.queryByText("Deleted: 1 · Failed: 0")).toBeNull();
});

test("resource scope changes clear cached content and selection", async () => {
	const view = render(
		<MemoryRouter>
			<QueryScope value="a">
				<PreparedMediaPage onDeleted={onDeleted} />
			</QueryScope>
		</MemoryRouter>,
	);
	await screen.findByText("First.mkv");
	fireEvent.click(screen.getByRole("button", { name: "Select" }));
	fireEvent.click(screen.getByRole("checkbox", { name: "Select this page" }));
	vi.mocked(api.getPreparedMedia).mockImplementation(
		() => new Promise(() => {}),
	);
	view.rerender(
		<MemoryRouter>
			<QueryScope value="b">
				<PreparedMediaPage onDeleted={onDeleted} />
			</QueryScope>
		</MemoryRouter>,
	);
	expect(screen.queryByText("First.mkv")).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Delete selected (2)" }),
	).toBeNull();
});

test.each(["/directories/nested", "/prepared-media"])(
	"Files navigation stays active at %s",
	async (path) => {
		render(
			<MemoryRouter initialEntries={[path]}>
				<AppHeader />
				<Routes>
					<Route element={<FilesLayout />}>
						<Route path="*" element={<p>Content</p>} />
					</Route>
				</Routes>
			</MemoryRouter>,
		);
		const nav = screen.getByRole("navigation", { name: "Files" });
		expect(
			within(nav)
				.getByRole("link", {
					name: path.startsWith("/directories")
						? "Original files"
						: "Prepared copies",
				})
				.getAttribute("aria-current"),
		).toBe("page");
		expect(screen.getByRole("link", { name: "Files" }).className).toContain(
			"app-nav-active",
		);
	},
);

const runtime = { library: { scan: { status: "idle" } } };
function RuntimeChild() {
	const context = useOutletContext<typeof runtime>();
	return <p>{context.library.scan.status}</p>;
}
test("Files layout passes runtime context through its nested outlet", () => {
	render(
		<MemoryRouter initialEntries={["/directories/nested"]}>
			<Routes>
				<Route element={<Outlet context={runtime} />}>
					<Route element={<FilesLayout />}>
						<Route path="directories/:id" element={<RuntimeChild />} />
					</Route>
				</Route>
			</Routes>
		</MemoryRouter>,
	);
	expect(screen.getByText("idle")).toBeTruthy();
});

test("an empty inventory explains how to create copies and links to original files without pagination", async () => {
	listing.items = [];
	listing.total = 0;
	listing.usage = {
		...listing.usage,
		count: 0,
		copyBytes: 0,
		retainedBytes: 0,
	};
	show();
	await screen.findByRole("heading", { name: "No prepared copies yet" });
	expect(screen.getByText(/Pre-transcode a file from its menu/)).toBeTruthy();
	expect(
		screen.getByRole("link", { name: "Browse files" }).getAttribute("href"),
	).toBe("/directories/root");
	expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
	expect(screen.queryByRole("button", { name: /Delete selected/ })).toBeNull();
});

test("no search results offer a clear-filters action which preserves sorting and restores copies", async () => {
	vi.mocked(api.getPreparedMedia).mockImplementation(async (input) => ({
		...listing,
		items: input.search || input.status ? [] : [one],
		total: input.search || input.status ? 0 : 1,
	}));
	show("/prepared-media?search=missing&status=unavailable&sort=size&page=2");
	await screen.findByRole("heading", { name: "No matching copies" });
	expect(
		screen
			.getByRole("searchbox", { name: "Search filename or path" })
			.getAttribute("placeholder"),
	).toBe("Search filename or path");
	expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
	await screen.findByText("First.mkv");
	expect(screen.getByLabelText("Location").textContent).toBe(
		"/prepared-media?sort=size",
	);
});

test("a failed refresh of an empty inventory shows recovery without claiming a confirmed empty result", async () => {
	listing.items = [];
	listing.total = 0;
	listing.usage.count = 0;
	show();
	await screen.findByRole("heading", { name: "No prepared copies yet" });
	vi.mocked(api.getPreparedMedia).mockRejectedValue(new Error("offline"));
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByRole("alert");
	expect(
		screen.queryByRole("heading", { name: "No prepared copies yet" }),
	).toBeNull();
	expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});

test("selection is opt-in and leaving the mode clears selected copies", async () => {
	show();
	await screen.findByText("First.mkv");
	expect(screen.queryByRole("checkbox")).toBeNull();
	expect(screen.queryByRole("button", { name: /Delete selected/ })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Select" }));
	fireEvent.click(screen.getByRole("checkbox", { name: "Select First.mkv" }));
	expect(
		screen.getByRole("button", { name: "Delete selected (1)" }),
	).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Done" }));
	expect(screen.queryByRole("checkbox")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Select" }));
	expect(
		(
			screen.getByRole("button", {
				name: "Delete selected (0)",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
});

test("compact entries reveal source paths and generation time on demand", async () => {
	show();
	const name = await screen.findByRole("button", { name: "First.mkv" });
	expect(screen.queryByText(one.sourcePath)).toBeNull();
	fireEvent.click(name);
	await screen.findByRole("tooltip");
	expect(screen.getByText(one.sourcePath)).toBeTruthy();
});

test("all-failed deletions use an error toast and preserve retryable selections", async () => {
	vi.mocked(api.deletePreparedMediaBatch).mockResolvedValue({
		results: [{ id: one.id, error: "PREPARATION_BUSY" }],
	});
	show();
	const row = (await screen.findByText("First.mkv")).closest("li");
	if (!row) throw new Error("Missing row");
	fireEvent.click(within(row).getByRole("button", { name: "Delete copy" }));
	fireEvent.click(
		within(await screen.findByRole("dialog")).getByRole("button", {
			name: "Delete copy",
		}),
	);
	await waitFor(() =>
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "error",
				title: "Could not delete 1 copy",
				timeout: 0,
				actionProps: expect.objectContaining({ children: "Retry" }),
			}),
		),
	);
	expect(screen.queryByText(/Deleted:.*Failed:/)).toBeNull();
});

test("an empty later copy page hides selection and pagination while preserving filter recovery", async () => {
	listing.items = [];
	listing.page = 2;
	listing.total = 51;
	show("/prepared-media?page=2&sort=size");
	await screen.findByRole("heading", { name: "No matching copies" });
	expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
	await waitFor(() =>
		expect(api.getPreparedMedia).toHaveBeenLastCalledWith(
			expect.objectContaining({ page: "1", sort: "size" }),
			expect.anything(),
		),
	);
});

test("manual refresh exposes busy state without hiding copies and re-enables when finished", async () => {
	show();
	await screen.findByText("First.mkv");
	let finish: ((value: PreparedMediaList) => void) | undefined;
	vi.mocked(api.getPreparedMedia).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const refresh = screen.getByRole("button", { name: "Refresh" });
	fireEvent.click(refresh);
	await waitFor(() => expect(refresh.getAttribute("aria-busy")).toBe("true"));
	expect((refresh as HTMLButtonElement).disabled).toBe(true);
	expect(screen.getByText("First.mkv")).toBeTruthy();
	const complete = finish;
	if (!complete) throw Error("Refresh request was not started");
	await act(async () => complete(structuredClone(listing)));
	await waitFor(() => expect(refresh.getAttribute("aria-busy")).toBe("false"));
	expect((refresh as HTMLButtonElement).disabled).toBe(false);
});
