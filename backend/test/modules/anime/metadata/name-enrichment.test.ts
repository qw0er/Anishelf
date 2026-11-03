import { afterEach, expect, test, vi } from "vitest";
import { MetadataNameEnrichment } from "../../../../src/modules/anime/external-works/metadata/application/name-enrichment.js";
import type { CachedMetadata } from "../../../../src/modules/anime/external-works/metadata/domain/model.js";
import type {
	ProviderCapabilities,
	WorkDetails,
} from "../../../../src/modules/anime/external-works/metadata/domain/source-model.js";
import type { SourceMetadataApi } from "../../../../src/modules/anime/external-works/metadata/ports.js";

const envelope = <T>(data: T): CachedMetadata<T> => ({
	data,
	snapshotId: "source-snapshot",
	fetchedAt: 1,
	stale: false,
	refreshing: false,
	refreshError: null,
});
function work(provider: string, id = "1"): WorkDetails {
	return {
		reference: { provider, mediaType: "anime", id },
		titles: [
			{ value: "共通の原名", kind: "native", language: null },
			{ value: `${provider} alias`, kind: "alias", language: null },
		],
		unavailableFields: [],
		year: 2023,
		format: "TV",
		status: "FINISHED",
		episodeCount: 12,
		startDate: { year: 2023, month: 9, day: 29 },
		endDate: null,
		airingSeason: null,
		nextAiringEpisode: null,
		coverUrl: null,
		bannerUrl: null,
		description: `${provider} description`,
		genres: [],
		tags: [],
		studios: [],
		durationMinutes: null,
		country: null,
		source: null,
		averageScore: null,
		streamingEpisodes: [],
		episodeCatalog: "unavailable",
		siteUrl: null,
		providerUpdatedAt: null,
	};
}
function fixture() {
	const one = work("one"),
		two = work("two");
	const items = [one, two];
	const source: Pick<
		SourceMetadataApi,
		"providers" | "search" | "get" | "current"
	> = {
		providers: () =>
			["one", "two"].map(
				(key) =>
					({
						key,
						version: "test",
						search: true,
						details: true,
						relations: false,
						airing: false,
						streamingLinks: false,
						canonicalEpisodes: false,
					}) satisfies ProviderCapabilities,
			),
		search: vi.fn(async (request) =>
			envelope({
				items: items.filter(
					(item) => item.reference.provider === request.provider,
				),
				page: 1,
				perPage: 50,
				hasNextPage: false,
			}),
		),
		get: vi.fn(async (reference) => {
			const found = items.find(
				(item) =>
					item.reference.provider === reference.provider &&
					item.reference.id === reference.id,
			);
			if (!found) throw new Error("Not found");
			return envelope(found);
		}),
		current: (reference) => {
			const found = items.find(
				(item) =>
					item.reference.provider === reference.provider &&
					item.reference.id === reference.id,
			);
			return found ? envelope(found) : null;
		},
	};
	return { one, two, items, source, names: new MetadataNameEnrichment(source) };
}
afterEach(() => vi.useRealTimers());
test("exact, mutually unique evidence supplements only names in both directions", async () => {
	const f = fixture(),
		input = envelope(f.one),
		before = structuredClone(input);
	const enriched = await f.names.enrich(input);
	expect(enriched.data.titles).toContainEqual({
		value: "two alias",
		kind: "alias",
		language: null,
	});
	expect({ ...enriched.data, titles: before.data.titles }).toEqual(before.data);
	expect(input).toEqual(before);
	expect(f.names.cached(envelope(f.two)).data.titles).toContainEqual({
		value: "one alias",
		kind: "alias",
		language: null,
	});
});
test.each([
	"native",
	"date",
	"format",
	"episodes",
	"missing-date",
	"missing-count",
])("%s disagreement never supplements names", async (field) => {
	const f = fixture();
	if (field === "native")
		f.two.titles[0] = { value: "Similar 原名", kind: "native", language: null };
	if (field === "date") f.two.startDate = { year: 2023, month: 9, day: 30 };
	if (field === "format") f.two.format = "ONA";
	if (field === "episodes") f.two.episodeCount = 13;
	if (field === "missing-date")
		f.two.startDate = { year: 2023, month: 9, day: null };
	if (field === "missing-count") f.two.episodeCount = null;
	expect((await f.names.enrich(envelope(f.one))).data.titles).toEqual(
		f.one.titles,
	);
});
test.each(["one", "two"])(
	"multiple exact candidates on %s reject supplementation",
	async (provider) => {
		const f = fixture();
		f.items.push(work(provider, "2"));
		expect((await f.names.enrich(envelope(f.one))).data.titles).toEqual(
			f.one.titles,
		);
	},
);
test("truncated search, stale evidence and provider errors retain the original result", async () => {
	for (const mode of ["truncated", "stale", "failure"]) {
		const f = fixture();
		vi.mocked(f.source.search).mockImplementation(async (request) => {
			if (mode === "failure") throw new Error("Offline");
			return {
				...envelope({
					items: f.items.filter(
						(item) => item.reference.provider === request.provider,
					),
					page: 1,
					perPage: 50,
					hasNextPage: mode === "truncated",
				}),
				stale: mode === "stale",
			};
		});
		expect((await f.names.enrich(envelope(f.one))).data.titles).toEqual(
			f.one.titles,
		);
	}
});
test("cached-only reads do not start verification and changed dates invalidate cached names", async () => {
	const f = fixture();
	await f.names.enrich(envelope(f.one), { cachedOnly: true });
	expect(f.source.search).not.toHaveBeenCalled();
	expect(f.source.get).not.toHaveBeenCalled();
	await f.names.enrich(envelope(f.one));
	f.two.startDate = { year: 2023, month: 9, day: 30 };
	expect(f.names.cached(envelope(f.one)).data.titles).toEqual(f.one.titles);
});
test("verification expires and never promotes supplemental names to primary titles", async () => {
	vi.useFakeTimers();
	const f = fixture();
	f.two.titles.push({ value: "Peer English", kind: "english", language: "en" });
	const result = await f.names.enrich(envelope(f.one));
	expect(result.data.titles).toContainEqual({
		value: "Peer English",
		searchKind: "english",
		kind: "alias",
		language: "en",
	});
	await vi.advanceTimersByTimeAsync(10 * 60_000);
	expect(f.names.cached(envelope(f.one)).data.titles).toEqual(f.one.titles);
});

test("an incomplete competing candidate cannot be silently ruled out", async () => {
	const f = fixture(),
		competitor = work("two", "2");
	competitor.startDate = null;
	f.items.push(competitor);
	expect((await f.names.enrich(envelope(f.one))).data.titles).toEqual(
		f.one.titles,
	);
});
test("cancelling the main request cancels optional verification", async () => {
	const f = fixture(),
		controller = new AbortController();
	controller.abort();
	await expect(
		f.names.enrich(envelope(f.one), { signal: controller.signal }),
	).rejects.toThrow();
});

test("explicit peer roles are retained even when the same name already exists as an unlabelled alias", async () => {
	const f = fixture();
	f.one.titles.push({ value: "English name", kind: "alias", language: null });
	f.two.titles.push({ value: "English name", kind: "english", language: "en" });
	expect((await f.names.enrich(envelope(f.one))).data.titles).toContainEqual({
		value: "English name",
		kind: "alias",
		language: null,
		searchKind: "english",
	});
});
