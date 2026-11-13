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
test.each(["native", "format"])(
	"%s conflict never supplements names",
	async (field) => {
		const f = fixture();
		if (field === "native")
			f.two.titles[0] = {
				value: "Similar 原名",
				kind: "native",
				language: null,
			};
		if (field === "format") f.two.format = "ONA";
		expect((await f.names.enrich(envelope(f.one))).data.titles).toEqual(
			f.one.titles,
		);
	},
);
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

function crossLanguageFixture() {
	const f = fixture();
	f.one.titles = [
		{
			value: "サイバーパンク: エッジランナーズ2",
			kind: "native",
			language: null,
		},
		{ value: "Cyberpunk: Edgerunners 2", kind: "english", language: "en" },
		{ value: "Cyberpunk: Edgerunners 2", kind: "romaji", language: null },
	];
	f.two.titles = [
		{ value: "Cyberpunk: Edgerunners 2", kind: "native", language: null },
		{ value: "赛博朋克：边缘行者 2", kind: "alias", language: "zh-Hans" },
	];
	for (const item of f.items) {
		item.format = "ONA";
		item.episodeCount = 10;
		item.startDate = { year: 2026, month: 10, day: 20 };
	}
	vi.mocked(f.source.search).mockImplementation(async (request) =>
		envelope({
			items: f.items.filter(
				(item) =>
					item.reference.provider === request.provider &&
					item.titles.some((title) => title.value === request.query),
			),
			page: 1,
			perPage: 50,
			hasNextPage: false,
		}),
	);
	return f;
}

test.each(["english", "romaji"] as const)(
	"different native languages can verify through a shared explicit %s name",
	async (role) => {
		const f = crossLanguageFixture();
		f.one.titles = f.one.titles.filter(
			(title) => title.kind === "native" || title.kind === role,
		);
		const shared = f.one.titles.find((title) => title.kind === role);
		if (shared) f.one.titles.push({ ...shared });
		const before = structuredClone(f.one);
		const result = await f.names.enrich(envelope(f.one));
		expect(result.data.titles).toContainEqual({
			value: "赛博朋克：边缘行者 2",
			kind: "alias",
			language: "zh-Hans",
		});
		expect(result.data.reference).toEqual(f.one.reference);
		expect(result.data.titles[0]).toEqual(before.titles[0]);
		expect(f.one).toEqual(before);
		// Repeated explicit spellings are searched only once per source.
		expect(f.source.search).toHaveBeenCalledTimes(4);
		expect(f.names.cached(envelope(f.two)).data.titles).toContainEqual({
			value: "サイバーパンク: エッジランナーズ2",
			kind: "alias",
			language: null,
		});
	},
);

test.each([undefined, "english", "romaji"] as const)(
	"unlabelled or supplemental alias role %s cannot establish correspondence",
	async (searchKind) => {
		const f = crossLanguageFixture();
		f.one.titles = [
			{
				value: "サイバーパンク: エッジランナーズ2",
				kind: "native",
				language: null,
			},
			{
				value: "Cyberpunk: Edgerunners 2",
				kind: "alias",
				language: null,
				...(searchKind ? { searchKind } : {}),
			},
		];
		expect((await f.names.enrich(envelope(f.one))).data.titles).toEqual(
			f.one.titles,
		);
	},
);

test.each(["one", "two"])(
	"alternate-title competitors on %s still reject a cross-language correspondence",
	async (provider) => {
		const f = crossLanguageFixture();
		const competitor = work(provider, "competitor");
		competitor.titles = [
			{ value: "Cyberpunk: Edgerunners 2", kind: "english", language: "en" },
		];
		competitor.format = "ONA";
		competitor.episodeCount = 10;
		competitor.startDate = { year: 2026, month: 10, day: 20 };
		f.items.push(competitor);
		expect((await f.names.enrich(envelope(f.one))).data.titles).toEqual(
			f.one.titles,
		);
	},
);

test("changing either source's explicit title evidence invalidates cross-language cached names", async () => {
	for (const side of ["one", "two"] as const) {
		const f = crossLanguageFixture();
		expect((await f.names.enrich(envelope(f.one))).data.titles).toHaveLength(4);
		f[side].titles.push({
			value: "Another explicit title",
			kind: "english",
			language: "en",
		});
		expect(f.names.cached(envelope(f.one)).data.titles).toEqual(f.one.titles);
		expect(f.names.cached(envelope(f.two)).data.titles).toEqual(f.two.titles);
	}
});

test("an incomplete alternate-title competitor cannot be silently excluded", async () => {
	const f = crossLanguageFixture();
	const competitor = work("two", "competitor");
	competitor.titles = [
		{ value: "Cyberpunk: Edgerunners 2", kind: "english", language: "en" },
	];
	competitor.format = "ONA";
	competitor.episodeCount = 10;
	competitor.startDate = null;
	competitor.year = 2026;
	f.items.push(competitor);
	expect((await f.names.enrich(envelope(f.one))).data.titles).toEqual(
		f.one.titles,
	);
});

test("a competitor discoverable only through the peer's additional explicit name rejects reverse verification", async () => {
	const f = crossLanguageFixture();
	f.two.titles.push({
		value: "Another official English spelling",
		kind: "english",
		language: "en",
	});
	const competitor = work("one", "competitor");
	competitor.titles = [
		{
			value: "Another official English spelling",
			kind: "english",
			language: "en",
		},
	];
	competitor.format = "ONA";
	competitor.episodeCount = 10;
	competitor.startDate = { year: 2026, month: 10, day: 20 };
	f.items.push(competitor);
	expect((await f.names.enrich(envelope(f.one))).data.titles).toEqual(
		f.one.titles,
	);
	expect(f.names.cached(envelope(f.two)).data.titles).toEqual(f.two.titles);
});

test("shared verification failures remain visible to background callers while foreground reads fall back", async () => {
	const f = fixture();
	f.source.search = vi.fn(async () => {
		throw new Error("Provider offline");
	});
	const result = await Promise.allSettled([
		f.names.enrich(envelope(f.one)),
		f.names.enrich(
			envelope(f.one),
			{},
			{ timeoutMs: 20000, throwOnFailure: true },
		),
	]);
	expect(result[0]).toMatchObject({
		status: "fulfilled",
		value: { data: { titles: f.one.titles } },
	});
	expect(result[1]).toMatchObject({
		status: "rejected",
		reason: new Error("Provider offline"),
	});
	expect(f.source.search).toHaveBeenCalledTimes(2);
});

test("a foreground timeout does not delay its fallback or cancel the shared background verification", async () => {
	const f = fixture();
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	vi.mocked(f.source.search).mockImplementation(async (request) => {
		await gate;
		return envelope({
			items: f.items.filter(
				(item) => item.reference.provider === request.provider,
			),
			page: 1,
			perPage: 50,
			hasNextPage: false,
		});
	});
	const foreground = f.names.enrich(envelope(f.one), {}, { timeoutMs: 5 });
	const background = f.names.enrich(
		envelope(f.one),
		{},
		{ timeoutMs: 1000, throwOnFailure: true },
	);
	expect((await foreground).data.titles).toEqual(f.one.titles);
	release();
	expect((await background).data.titles).toContainEqual({
		value: "two alias",
		kind: "alias",
		language: null,
	});
	expect(f.source.search).toHaveBeenCalledTimes(2);
});

test("stale candidate caches are awaited through one forced refresh before verification", async () => {
	const f = fixture();
	vi.mocked(f.source.search).mockImplementation(async (request, options) => ({
		...envelope({
			items: f.items.filter(
				(item) => item.reference.provider === request.provider,
			),
			page: 1,
			perPage: 50,
			hasNextPage: false,
		}),
		stale: options?.refresh !== true,
	}));
	const read = vi.mocked(f.source.get).getMockImplementation();
	if (!read) throw new Error("Missing source reader fixture");
	vi.mocked(f.source.get).mockImplementation(async (reference, options) => ({
		...(await read(reference, options)),
		stale: reference.provider === "two" && options?.refresh !== true,
	}));
	expect((await f.names.enrich(envelope(f.one))).data.titles).toContainEqual({
		value: "two alias",
		kind: "alias",
		language: null,
	});
	expect(f.source.search).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({ refresh: true }),
	);
});

test("cached upstream refresh errors reject background verification without bypassing cooldown", async () => {
	const f = fixture();
	vi.mocked(f.source.search).mockImplementation(async (request) => ({
		...envelope({
			items: f.items.filter(
				(item) => item.reference.provider === request.provider,
			),
			page: 1,
			perPage: 50,
			hasNextPage: false,
		}),
		stale: true,
		refreshError: {
			code: "unavailable",
			message: "Provider cooldown",
			retryAt: Date.now() + 60000,
		},
	}));
	await expect(
		f.names.enrich(envelope(f.one), {}, { throwOnFailure: true }),
	).rejects.toMatchObject({ failure: { code: "unavailable" } });
	expect(f.source.search).toHaveBeenCalledTimes(2);
	expect(f.source.search).not.toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({ refresh: true }),
	);
});

test.each([
	"date",
	"episodes",
	"missing-date",
	"missing-count",
	"format-family",
])(
	"%s is auxiliary evidence rather than an unconditional rejection",
	async (field) => {
		const f = fixture();
		if (field === "date") f.two.startDate = { year: 2023, month: 9, day: 30 };
		if (field === "episodes") f.two.episodeCount = 13;
		if (field === "missing-date")
			f.two.startDate = { year: 2023, month: 9, day: null };
		if (field === "missing-count") f.two.episodeCount = null;
		if (field === "format-family") f.two.format = "TV_SHORT";
		expect((await f.names.enrich(envelope(f.one))).data.titles).toContainEqual({
			value: "two alias",
			kind: "alias",
			language: null,
		});
	},
);
