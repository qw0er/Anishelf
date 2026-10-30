// @vitest-environment happy-dom
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import type { ViewingState } from "../../../src/features/anime/tracking/use-viewing-state.js";
import { ViewingSummary } from "../../../src/features/anime/tracking/viewing-summary.js";
import "../../../src/shared/i18n.js";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "../../support/query-test-utils.js";
import { trackingProvider } from "../../support/tracking-fixture.js";

afterEach(cleanup);
function viewing(): ViewingState {
	return {
		visible: true,
		loading: false,
		refreshing: false,
		reconnect: false,
		error: null,
		retry: vi.fn(),
		snapshot: {
			provider: trackingProvider,
			accountId: "anilist:7",
			generation: "viewing",
			state: "connected",
			fetchedAt: 1000,
			stale: false,
			refreshing: false,
			error: null,
			entry: {
				id: "anilist:1",
				mediaId: "anilist:anime:2",
				progress: 8,
				status: "watching",
				updatedAt: 1,
				titles: ["Work"],
				format: "TV",
				year: 2025,
				episodeCount: 12,
				coverUrl: null,
			},
		},
	};
}

test("the compact summary uses the provider total and moves cumulative explanations into an accessible Tooltip", async () => {
	render(<ViewingSummary state={viewing()} episodeCount={28} />, {
		wrapper: MemoryRouter,
	});
	expect(screen.getByText("Watching")).toBeTruthy();
	expect(screen.getByText("8 / 28 episodes")).toBeTruthy();
	expect(screen.queryByRole("heading")).toBeNull();
	expect(screen.queryByText(/AniList progress is cumulative/)).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "About the tracking service progress" }),
	);
	const tooltip = await screen.findByRole("tooltip");
	expect(tooltip.textContent).toContain("separate from local playback history");
	expect(
		screen
			.getByRole("button", { name: "About the tracking service progress" })
			.getAttribute("aria-describedby"),
	).toBe(tooltip.id);
});

test("episode progress uses aired episodes as the denominator and keeps the total in parentheses", () => {
	render(
		<ViewingSummary
			state={viewing()}
			episodeCount={12}
			airedEpisodeCount={10}
		/>,
		{
			wrapper: MemoryRouter,
		},
	);
	expect(screen.getByText("8 / 10 (12) episodes")).toBeTruthy();
});

test("an unknown total never invents a denominator or hides cumulative progress", () => {
	const state = viewing();
	render(<ViewingSummary state={state} episodeCount={null} />, {
		wrapper: MemoryRouter,
	});
	expect(screen.getByText("8 episodes")).toBeTruthy();
	expect(screen.queryByText(/8\s*\//)).toBeNull();
});

test("a pending initial list uses a skeleton until a complete snapshot establishes that an entry is absent", () => {
	const state = viewing();
	if (!state.snapshot) throw new Error("Missing snapshot fixture");
	state.snapshot.entry = null;
	state.snapshot.fetchedAt = null;
	state.snapshot.refreshing = true;
	state.refreshing = true;
	const view = render(<ViewingSummary state={state} />, {
		wrapper: MemoryRouter,
	});
	expect(
		screen.getByRole("status", {
			name: "the tracking service viewing state has not loaded yet.",
		}),
	).toBeTruthy();
	expect(screen.queryByText("Not on the tracking service")).toBeNull();
	view.rerender(
		<ViewingSummary
			state={{
				...state,
				refreshing: false,
				snapshot: {
					...state.snapshot,
					fetchedAt: 2000,
					refreshing: false,
				},
			}}
		/>,
	);
	expect(screen.getByText("Not on the tracking service")).toBeTruthy();
	expect(screen.queryByRole("status")).toBeNull();
});

test("saved viewing state stays visible during reconnection and cache time is available on demand", async () => {
	const state = viewing();
	if (!state.snapshot) throw new Error("Missing snapshot fixture");
	state.reconnect = true;
	state.snapshot.state = "authorization-required";
	state.snapshot.stale = true;
	render(<ViewingSummary state={state} />, { wrapper: MemoryRouter });
	expect(screen.getByText("Watching")).toBeTruthy();
	expect(screen.getByText("8 / 12 episodes")).toBeTruthy();
	expect(
		screen.getByRole("link", { name: "Reconnect" }).getAttribute("href"),
	).toBe("/settings");
	expect(
		screen.queryByText(/Showing saved the tracking service viewing state/),
	).toBeNull();
	act(() =>
		screen
			.getByRole("button", { name: "Refresh the tracking service list" })
			.focus(),
	);
	expect((await screen.findByRole("tooltip")).textContent).toContain(
		"Last updated:",
	);
});

test("initial read errors expose a compact failure and a working retry instead of a false untracked state", () => {
	const state = {
		...viewing(),
		snapshot: undefined,
		error: new Error("Unavailable"),
	};
	render(<ViewingSummary state={state} />, { wrapper: MemoryRouter });
	expect(screen.getByRole("alert").textContent).toBe(
		"Viewing state unavailable",
	);
	expect(screen.queryByText("Not on the tracking service")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(state.retry).toHaveBeenCalledTimes(1);
});

test("cached, refreshing and failed background reads retain the same summary controls", async () => {
	const state = viewing();
	if (!state.snapshot) throw Error("Missing snapshot fixture");
	const view = render(<ViewingSummary state={state} />, {
		wrapper: MemoryRouter,
	});
	const region = screen.getByRole("region", {
		name: "the tracking service viewing state",
	});
	const childCount = region.children.length;
	const refresh = screen.getByRole("button", {
		name: "Refresh the tracking service list",
	});
	view.rerender(
		<ViewingSummary
			state={{
				...state,
				refreshing: true,
				snapshot: {
					...state.snapshot,
					stale: true,
					refreshing: true,
				},
			}}
		/>,
	);
	expect(
		screen.getByRole("button", { name: "Refresh the tracking service list" }),
	).toBe(refresh);
	expect(refresh.getAttribute("aria-busy")).toBe("true");
	expect(region.children.length).toBe(childCount);
	expect(screen.queryByText("Cached")).toBeNull();
	expect(
		screen.queryByText("Showing cached the tracking service viewing state."),
	).toBeNull();
	view.rerender(
		<ViewingSummary
			state={{
				...state,
				error: new Error("Offline"),
				snapshot: {
					...state.snapshot,
					stale: true,
				},
			}}
		/>,
	);
	expect(screen.getByText("8 / 12 episodes")).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
	expect(region.children.length).toBe(childCount);
	fireEvent.click(refresh);
	expect(state.retry).toHaveBeenCalledTimes(1);
});
