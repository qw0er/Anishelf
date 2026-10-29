// @vitest-environment happy-dom
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { PlayerContinuation } from "../src/features/anime/catalog/components/player-continuation.js";
import {
	continuationContext,
	continuationEpisode,
} from "../src/features/anime/catalog/continuation.js";
import {
	localWorkDetailQuery,
	sourceQuery,
} from "../src/features/anime/catalog/queries.js";
import { AutomaticContinuationSetting } from "../src/features/settings/components/playback-preferences.js";
import type { CatalogSourceResponse } from "../src/shared/api/contracts.js";
import { queryClient } from "../src/shared/api/query-client.js";
import { animeDetailFixture, animeFixture } from "./fixtures/anime.js";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "./query-test-utils.js";
import "../src/shared/i18n.js";

const preferenceKey = "anishelf.autoContinue";
function sourceFixture(numbers = [1]): CatalogSourceResponse {
	return {
		sourceVersion: "v1",
		associations: numbers.map((number) => ({
			workId: "work-1",
			workTitle: "Frieren",
			episodeId: `ep-${number}`,
			kind: "regular",
			number: String(number),
			label: `Episode ${number}`,
		})),
	};
}
function seed(versions = 1) {
	const detail = animeFixture();
	const template = detail.episodes[0]?.versions[0];
	const next = detail.episodes[1];
	if (!template || !next) throw Error("Missing fixture");
	next.versions = Array.from({ length: versions }, (_, index) => ({
		...template,
		fileId: `file-${index + 2}`,
		sourceId: `source-${index + 2}`,
		sourceVersion: `v${index + 2}`,
		relativePath: `Episode 02 version ${index + 1}.mkv`,
	}));
	queryClient.setQueryData(sourceQuery("file-1", "").queryKey, sourceFixture());
	queryClient.setQueryData(localWorkDetailQuery("work-1", "").queryKey, {
		...detail,
		detail: animeDetailFixture(detail),
	});
	return detail;
}
function Harness({
	ended,
	overlayTarget,
}: {
	ended: boolean;
	overlayTarget?: HTMLElement | null | undefined;
}) {
	const location = useLocation();
	return (
		<>
			<output data-testid="destination">
				{location.pathname}
				{location.search}
			</output>
			<output data-testid="autoplay">{String(location.state?.autoPlay)}</output>
			{location.pathname === "/files/file-1" && (
				<PlayerContinuation
					fileId="file-1"
					sourceVersion="v1"
					ended={ended}
					overlayTarget={overlayTarget}
				/>
			)}
		</>
	);
}
function tree(ended = false, overlayTarget?: HTMLElement | null) {
	return (
		<MemoryRouter
			initialEntries={[
				"/files/file-1?anime=work-1&episode=ep-1&library=%2F%3Fsearch%3DFrieren&audio=9&asset=old",
			]}
		>
			<Harness ended={ended} overlayTarget={overlayTarget} />
		</MemoryRouter>
	);
}
afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

test("continuation resolves whole-file ranges and rejects stale, mixed, fractional or ambiguous mappings", () => {
	expect(continuationContext(sourceFixture([1, 2]), "v1")).toEqual({
		workId: "work-1",
		nextNumber: 3,
	});
	expect(continuationContext(sourceFixture(), "old")).toBeNull();
	for (const numbers of [[1, 3], [1.5], [0]])
		expect(continuationContext(sourceFixture(numbers), "v1")).toBeNull();
	for (const kind of ["special", "movie"] as const) {
		const source = sourceFixture();
		for (const item of source.associations) item.kind = kind;
		expect(continuationContext(source, "v1")).toBeNull();
	}
	const mixed = sourceFixture([1, 2]);
	if (mixed.associations[1]) mixed.associations[1].workId = "other";
	expect(continuationContext(mixed, "v1")).toBeNull();
});

test("continuation never skips a gap, replays the current file or selects unavailable versions", () => {
	const detail = animeFixture();
	expect(continuationEpisode(detail.episodes, 2, "file-1")?.versions).toEqual(
		[],
	);
	expect(continuationEpisode(detail.episodes, 4, "file-1")).toBeNull();
	expect(continuationEpisode(detail.episodes, 1, "file-1")?.versions).toEqual(
		[],
	);
});

test("manual navigation preserves library context, chooses the correct episode and clears old audio/asset parameters", () => {
	seed();
	render(tree());
	expect(
		screen.queryByRole("checkbox", { name: "Continue automatically" }),
	).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Next: Episode 2" }));
	const path = screen.getByTestId("destination").textContent ?? "";
	const url = new URL(path, "http://test.invalid");
	expect(url.pathname).toBe("/files/file-2");
	expect(Object.fromEntries(url.searchParams)).toEqual({
		anime: "work-1",
		episode: "ep-2",
		library: "/?search=Frieren",
		version: "v2",
	});
	expect(screen.getByTestId("autoplay").textContent).toBe("true");
});

test("missing episodes disable navigation without a separate availability explanation", () => {
	seed(0);
	render(tree(true));
	expect(
		screen
			.getByRole("button", { name: "Next: Episode 2" })
			.hasAttribute("disabled"),
	).toBe(true);
	expect(screen.getByRole("region", { name: "Next episode" }).textContent).toBe(
		"Next: Episode 2",
	);
});

test("multiple available versions require explicit choice even with automatic continuation enabled", async () => {
	seed(2);
	localStorage.setItem(preferenceKey, "true");
	render(tree(true));
	vi.useFakeTimers();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(11000);
	});
	expect(screen.getByTestId("destination").textContent).toContain(
		"/files/file-1?",
	);
	fireEvent.click(screen.getByRole("button", { name: "Next: Episode 2" }));
	const dialog = screen.getByRole("dialog");
	fireEvent.click(
		within(dialog).getAllByRole("button", { name: "Play" })[1] as HTMLElement,
	);
	expect(screen.getByTestId("destination").textContent).toContain(
		"/files/file-3?",
	);
});

test("enabled continuation waits for the end and navigates once after ten seconds", async () => {
	seed();
	localStorage.setItem(preferenceKey, "true");
	const view = render(tree());
	vi.useFakeTimers();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(11000);
	});
	expect(screen.queryByText(/Continuing in/)).toBeNull();
	view.rerender(tree(true));
	expect(screen.getByText("Continuing in 10 seconds…")).toBeTruthy();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(9000);
	});
	expect(screen.getByText("Continuing in 1 second…")).toBeTruthy();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1000);
	});
	expect(screen.getByTestId("destination").textContent).toContain(
		"/files/file-2?",
	);
});

test("cancel and replay reset the end countdown without changing the saved preference", async () => {
	seed();
	localStorage.setItem(preferenceKey, "true");
	const view = render(tree(true));
	vi.useFakeTimers();
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(12000);
	});
	expect(screen.queryByText(/Continuing in/)).toBeNull();
	expect(localStorage.getItem(preferenceKey)).toBe("true");
	view.rerender(tree());
	view.rerender(tree(true));
	expect(screen.getByText("Continuing in 10 seconds…")).toBeTruthy();
	view.rerender(tree());
	await act(async () => {
		await vi.advanceTimersByTimeAsync(12000);
	});
	expect(screen.getByTestId("destination").textContent).toContain(
		"/files/file-1?",
	);
});

test("changing the preference at the end persists it without retroactively starting playback", async () => {
	seed();
	render(
		<>
			{tree(true)}
			<AutomaticContinuationSetting />
		</>,
	);
	vi.useFakeTimers();
	fireEvent.click(
		screen.getByRole("checkbox", { name: "Continue automatically" }),
	);
	expect(localStorage.getItem(preferenceKey)).toBe("true");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(11000);
	});
	expect(screen.getByTestId("destination").textContent).toContain(
		"/files/file-1?",
	);
});

test("disabling the shared preference cancels the active countdown and re-enabling waits for another end", async () => {
	seed();
	localStorage.setItem(preferenceKey, "true");
	vi.useFakeTimers();
	render(
		<>
			{tree(true)}
			<AutomaticContinuationSetting />
		</>,
	);
	expect(screen.getByText("Continuing in 10 seconds…")).toBeTruthy();
	fireEvent.click(
		screen.getByRole("checkbox", { name: "Continue automatically" }),
	);
	expect(screen.queryByText(/Continuing in/)).toBeNull();
	fireEvent.click(
		screen.getByRole("checkbox", { name: "Continue automatically" }),
	);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(11000);
	});
	expect(screen.queryByText(/Continuing in/)).toBeNull();
	expect(screen.getByTestId("destination").textContent).toContain(
		"/files/file-1?",
	);
});

test("fullscreen moves the countdown presentation while preserving its timer and cancellation", async () => {
	seed();
	localStorage.setItem(preferenceKey, "true");
	const overlay = document.createElement("div");
	document.body.append(overlay);
	try {
		vi.useFakeTimers();
		const view = render(tree(true));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});
		view.rerender(tree(true, overlay));
		expect(within(overlay).getByText("Continuing in 7 seconds…")).toBeTruthy();
		fireEvent.click(within(overlay).getByRole("button", { name: "Cancel" }));
		view.rerender(tree(true));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(11000);
		});
		expect(screen.getByTestId("destination").textContent).toContain(
			"/files/file-1?",
		);
	} finally {
		overlay.remove();
	}
});

test("a target revision change cancels an active countdown", async () => {
	const detail = structuredClone(seed());
	localStorage.setItem(preferenceKey, "true");
	vi.useFakeTimers();
	render(tree(true));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(9000);
	});
	const version = detail.episodes[1]?.versions[0];
	if (!version) throw Error("Missing version fixture");
	version.sourceVersion = "changed-version";
	await act(async () =>
		queryClient.setQueryData(localWorkDetailQuery("work-1", "").queryKey, {
			...detail,
			detail: animeDetailFixture(detail),
		}),
	);
	expect(screen.queryByText(/Continuing in/)).toBeNull();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(11000);
	});
	expect(screen.getByTestId("destination").textContent).toContain(
		"/files/file-1?",
	);
});
