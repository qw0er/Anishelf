// @vitest-environment happy-dom
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { PlayerContinuation } from "../../../src/features/anime/catalog/components/player-continuation.js";
import {
	continuationContext,
	continuationEpisode,
} from "../../../src/features/anime/catalog/continuation.js";
import {
	localWorkDetailQuery,
	sourceQuery,
} from "../../../src/features/anime/catalog/queries.js";
import type { CatalogSourceResponse } from "../../../src/shared/api/contracts.js";
import { queryClient } from "../../../src/shared/api/query-client.js";
import "../../../src/shared/i18n.js";
import { animeDetailFixture, animeFixture } from "../../fixtures/anime.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "../../support/query-test-utils.js";

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
function Harness() {
	const location = useLocation();
	return (
		<>
			<output data-testid="destination">
				{location.pathname}
				{location.search}
			</output>
			<output data-testid="autoplay">{String(location.state?.autoPlay)}</output>
			{location.pathname === "/files/file-1" && (
				<PlayerContinuation fileId="file-1" sourceVersion="v1" />
			)}
		</>
	);
}
function tree() {
	return (
		<MemoryRouter
			initialEntries={[
				"/files/file-1?anime=work-1&episode=ep-1&library=%2F%3Fsearch%3DFrieren&audio=9&asset=old",
			]}
		>
			<Harness />
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
	render(tree());
	expect(
		screen
			.getByRole("button", { name: "Next: Episode 2" })
			.hasAttribute("disabled"),
	).toBe(true);
	expect(screen.getByRole("region", { name: "Next episode" }).textContent).toBe(
		"Next: Episode 2",
	);
});

test("multiple available versions require explicit choice", () => {
	seed(2);
	render(tree());
	fireEvent.click(screen.getByRole("button", { name: "Next: Episode 2" }));
	const dialog = screen.getByRole("dialog");
	fireEvent.click(
		within(dialog).getAllByRole("button", { name: "Play" })[1] as HTMLElement,
	);
	expect(screen.getByTestId("destination").textContent).toContain(
		"/files/file-3?",
	);
});
