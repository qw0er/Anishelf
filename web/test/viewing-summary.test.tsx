// @vitest-environment happy-dom
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import type { ViewingState } from "../src/features/anime/tracking/use-viewing-state.js";
import { ViewingSummary } from "../src/features/anime/tracking/viewing-summary.js";
import "../src/shared/i18n.js";
import { act, cleanup, fireEvent, render, screen } from "./query-test-utils.js";

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
			accountId: 7,
			generation: "viewing",
			state: "connected",
			fetchedAt: 1000,
			stale: false,
			refreshing: false,
			error: null,
			entry: {
				id: 1,
				mediaId: 2,
				progress: 8,
				status: "CURRENT",
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
		screen.getByRole("button", { name: "About AniList progress" }),
	);
	const tooltip = await screen.findByRole("tooltip");
	expect(tooltip.textContent).toContain("separate from local playback history");
	expect(
		screen
			.getByRole("button", { name: "About AniList progress" })
			.getAttribute("aria-describedby"),
	).toBe(tooltip.id);
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
			name: "AniList viewing state has not loaded yet.",
		}),
	).toBeTruthy();
	expect(screen.queryByText("Not on AniList")).toBeNull();
	view.rerender(
		<ViewingSummary
			state={{
				...state,
				refreshing: false,
				snapshot: { ...state.snapshot, fetchedAt: 2000, refreshing: false },
			}}
		/>,
	);
	expect(screen.getByText("Not on AniList")).toBeTruthy();
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
	expect(screen.queryByText(/Showing saved AniList viewing state/)).toBeNull();
	act(() =>
		screen.getByRole("button", { name: "AniList cache details" }).focus(),
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
	expect(screen.queryByText("Not on AniList")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(state.retry).toHaveBeenCalledTimes(1);
});
