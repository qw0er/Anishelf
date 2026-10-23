// @vitest-environment happy-dom
import { MemoryRouter } from "react-router";
import { afterEach, expect, test } from "vitest";
import { LibraryResults } from "../src/features/anime/library/components/library-results.js";
import type { AnimeLibraryResponse } from "../src/shared/api/contracts.js";
import { cleanup, render, screen, within } from "./query-test-utils.js";
import "../src/shared/i18n.js";

afterEach(cleanup);
type Card = AnimeLibraryResponse["items"][number];
const work: Card = {
	id: "work",
	localWorkId: "work",
	reference: { provider: "anilist", mediaType: "anime", id: "9" },
	displayTitle: "Example",
	format: "TV",
	year: 2026,
	episodeCount: 12,
	airedEpisodeCount: 8,
	updatedAt: 1,
	availableEpisodes: 0,
	availableRegularEpisodes: 0,
	availableUnwatchedEpisodes: 0,
	metadataStale: false,
	coverUrl: null,
	viewingAvailability: "tracked",
	viewing: { status: "watching", progress: 1, updatedAt: 1 },
};
function show(items: Card[]) {
	return render(
		<MemoryRouter>
			<LibraryResults items={items} librarySearch="?scope=all" viewingKnown />
		</MemoryRouter>,
	);
}
test("cards retain compact counts and accessible meaning without zero-count boilerplate or nested controls", () => {
	show([work]);
	const card = screen.getByRole("link", { name: "Example" });
	expect(within(card).getByText("Watching")).toBeTruthy();
	expect(within(card).getByText("1 / 8 (12)")).toBeTruthy();
	expect(within(card).queryByText(/Aired/)).toBeNull();
	expect(within(card).queryByText(/unwatched available/)).toBeNull();
	expect(within(card).queryByRole("button")).toBeNull();
	expect(card.getAttribute("href")).toContain("library=");
	expect(card.getAttribute("aria-describedby")).toBeTruthy();
	const description = document.getElementById(
		card.getAttribute("aria-describedby") ?? "",
	);
	expect(description?.textContent).toContain(
		"0 / 8 (12) regular episodes available",
	);
	expect(description?.textContent).toContain("1 / 8 (12) episodes");
});
test("unknown totals and movies keep compact viewing counts without local rows", () => {
	show([
		{
			...work,
			id: "unknown",
			displayTitle: "Unknown",
			episodeCount: null,
			availableEpisodes: 2,
			availableUnwatchedEpisodes: 2,
		},
		{
			...work,
			id: "movie",
			displayTitle: "Movie",
			format: "MOVIE",
			episodeCount: 1,
			availableEpisodes: 1,
		},
	]);
	const unknown = screen.getByRole("link", { name: "Unknown" });
	expect(within(unknown).getByText("1 / 8")).toBeTruthy();
	expect(within(unknown).queryByText(/local|unwatched available/i)).toBeNull();
	expect(
		within(screen.getByRole("link", { name: "Movie" })).queryByText(/Aired/),
	).toBeNull();
});
test("remote-only cards keep their remote route and show local availability once", () => {
	show([
		{
			...work,
			localWorkId: null,
			viewing: null,
			viewingAvailability: "untracked",
		},
	]);
	const card = screen.getByRole("link", { name: "Example" });
	expect(card.getAttribute("href")).toContain(
		"/anime/tracked/anilist%3Aanime%3A9?",
	);
	expect(within(card).getByText("Not on the tracking service")).toBeTruthy();
	expect(within(card).queryByText("No local resources")).toBeNull();
});

test("a missing cross-provider mapping is visible and is never presented as untracked", () => {
	show([{ ...work, viewing: null, viewingAvailability: "unmapped" }]);
	const card = screen.getByRole("link", { name: "Example" });
	expect(
		within(card).getByText("No confirmed mapping to the tracking provider."),
	).toBeTruthy();
	expect(within(card).queryByText("Not on the tracking service")).toBeNull();
});
