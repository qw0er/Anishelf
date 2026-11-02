// @vitest-environment happy-dom
import { useInfiniteQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AiringStatus } from "../../../src/features/anime/catalog/components/airing-status.js";
import type {
	MetadataAiringResponse,
	MetadataDetailsResponse,
} from "../../../src/shared/api/contracts.js";
import { queryClient } from "../../../src/shared/api/query-client.js";
import i18n from "../../../src/shared/i18n.js";
import { animeFixture } from "../../fixtures/anime.js";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../support/query-test-utils.js";

const now = new Date("2026-11-02T10:00:00Z").getTime();
function schedule(
	items: { episode: number; airingAt: number }[],
	options: Partial<MetadataAiringResponse> = {},
): MetadataAiringResponse {
	return {
		snapshotId: "schedule",
		fetchedAt: now,
		stale: false,
		refreshing: false,
		refreshError: null,
		data: {
			items: items.map((item) => ({ ...item, id: String(item.episode) })),
			page: 1,
			perPage: 25,
			hasNextPage: false,
		},
		...options,
	};
}
function Harness({
	data,
	metadata = null,
}: {
	data: MetadataAiringResponse;
	metadata?: MetadataDetailsResponse | null;
}) {
	const query = useInfiniteQuery({
		queryKey: ["airing-test"],
		initialPageParam: 1,
		queryFn: async () => data,
		initialData: { pages: [data], pageParams: [1] },
		getNextPageParam: (last) =>
			last.data.hasNextPage ? last.data.page + 1 : undefined,
		staleTime: Infinity,
	});
	return <AiringStatus query={query} metadata={metadata} />;
}
beforeEach(async () => {
	await i18n.changeLanguage("en");
});
afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test("future plans lead with the nearest broadcast and aired history is collapsed newest first", async () => {
	vi.spyOn(Date, "now").mockReturnValue(now);
	render(
		<Harness
			data={schedule([
				{ episode: 4, airingAt: now / 1000 + 600 },
				{ episode: 1, airingAt: now / 1000 - 1200 },
				{ episode: 3, airingAt: now / 1000 + 300 },
				{ episode: 2, airingAt: now / 1000 - 600 },
			])}
		/>,
	);
	const table = screen.getByRole("table");
	expect(
		within(table)
			.getAllByRole("rowheader")
			.map((row) => row.textContent),
	).toEqual(["Episode 3", "Episode 4"]);
	expect(screen.getByText("Next broadcast")).toBeTruthy();
	expect(screen.queryByText("Episode 1")).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "Aired history (2 episodes)" }),
	);
	await waitFor(() => expect(screen.getByText("Episode 1")).toBeTruthy());
	const history = screen.getAllByRole("table")[1];
	if (!history) throw new Error("Missing history");
	expect(
		within(history)
			.getAllByRole("rowheader")
			.map((row) => row.textContent),
	).toEqual(["Episode 2", "Episode 1"]);
});

test("next metadata remains visible while early schedule pages contain only history", () => {
	vi.spyOn(Date, "now").mockReturnValue(now);
	const metadata = animeFixture().metadata;
	metadata.fetchedAt = now;
	metadata.stale = false;
	metadata.data.nextAiringEpisode = {
		episode: 100,
		airingAt: now / 1000 + 3600,
	};
	const data = schedule([{ episode: 1, airingAt: now / 1000 - 3600 }]);
	data.data.hasNextPage = true;
	render(<Harness data={data} metadata={metadata} />);
	expect(screen.getByText("Episode 100")).toBeTruthy();
	expect(screen.getByText("Next broadcast")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Load more airing records" }),
	).toBeTruthy();
});

test("elapsed plans await confirmation at airtime and only refreshed evidence moves them to history", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(now);
	const data = schedule([{ episode: 3, airingAt: now / 1000 + 1 }]);
	const view = render(<Harness data={data} />);
	expect(screen.getByText("Next broadcast")).toBeTruthy();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1001);
	});
	expect(screen.getByText("Awaiting confirmation")).toBeTruthy();
	expect(screen.queryByText("Aired")).toBeNull();
	act(() =>
		queryClient.setQueryData(["airing-test"], {
			pages: [{ ...data, fetchedAt: Date.now() }],
			pageParams: [1],
		}),
	);
	view.rerender(<Harness data={data} />);
	expect(screen.queryByText("Awaiting confirmation")).toBeNull();
	expect(
		screen.getByRole("button", { name: "Aired history (1 episode)" }),
	).toBeTruthy();
});

test("cached future plans survive a failed refresh and remain unverified", () => {
	vi.spyOn(Date, "now").mockReturnValue(now);
	render(
		<Harness
			data={schedule([{ episode: 3, airingAt: now / 1000 + 300 }], {
				stale: true,
				refreshError: {
					code: "unavailable",
					message: "Offline",
					retryAt: null,
				},
			})}
		/>,
	);
	expect(screen.getByText("Episode 3")).toBeTruthy();
	expect(screen.getByText("Unverified")).toBeTruthy();
	expect(screen.queryByText("Next broadcast")).toBeNull();
});
