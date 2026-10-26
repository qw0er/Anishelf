import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { BangumiClient } from "../src/modules/anime/bangumi/public.js";
import { createMetadataModule } from "../src/modules/anime/metadata/create.js";
import { BangumiProvider } from "../src/modules/anime/metadata/infrastructure/bangumi.js";
import { createHttpApp } from "./support/http.js";

const logger = pino({ enabled: false });
const signal = () => new AbortController().signal;
const subject = (id = 400602) => ({
	id,
	type: 2,
	name: "葬送のフリーレン",
	name_cn: "葬送的芙莉莲",
	summary: "Story",
	date: "2023-09-29",
	platform: "TV",
	eps: 28,
	total_episodes: 99,
	images: { large: "https://lain.bgm.tv/pic/cover/l/test.jpg", common: "" },
	rating: { score: 8.7 },
	tags: [{ name: "冒险" }],
});
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
	vi.useRealTimers();
});
function client(fetcher: typeof fetch) {
	const value = new BangumiClient({ logger, fetch: fetcher });
	cleanup.push(() => value.close());
	return value;
}
function transport() {
	return vi.fn<typeof fetch>(async (input) => {
		const request = input as Request;
		if (request.method === "POST") {
			const url = new URL(request.url);
			return Response.json({
				total: 31,
				limit: Number(url.searchParams.get("limit")),
				offset: Number(url.searchParams.get("offset")),
				data: [subject()],
			});
		}
		return Response.json(subject());
	});
}
test("typed OpenAPI search sends anime filter, pagination and identifying User-Agent", async () => {
	const fetcher = transport();
	const result = await client(fetcher).search("芙莉莲", 2, 10, signal());
	const request = fetcher.mock.calls[0]?.[0] as Request;
	expect(request.url).toBe(
		"https://api.bgm.tv/v0/search/subjects?limit=10&offset=10",
	);
	expect(await request.json()).toEqual({
		keyword: "芙莉莲",
		sort: "match",
		filter: { type: [2] },
	});
	expect(request.headers.get("user-agent")).toMatch(
		/^qw0er\/Anishelf\/.+github.com\/qw0er\/Anishelf/,
	);
	expect(result.hasNextPage).toBe(true);
});
test.each([null, undefined, "2026-01-16"])(
	"search preserves mixed results when an air date is %s",
	async (date) => {
		const provider = new BangumiProvider(
			client(async () =>
				Response.json({
					total: 2,
					limit: 10,
					offset: 0,
					data: [subject(), { ...subject(638133), date }],
				}),
			),
		);
		const result = await provider.search("Frieren", 1, 10, signal());
		expect(result.data.items).toHaveLength(2);
		expect(result.data.items[0]?.year).toBe(2023);
		expect(result.data.items[1]).toMatchObject({
			reference: { id: "638133" },
			year: date ? 2026 : null,
		});
		expect(result.data.hasNextPage).toBe(false);
	},
);
test.each([null, undefined])(
	"detail projects an unknown air date %s without inventing a year",
	async (date) => {
		const provider = new BangumiProvider(
			client(async () => Response.json({ ...subject(), date })),
		);
		const result = await provider.get(
			{ provider: "bangumi", mediaType: "anime", id: "400602" },
			signal(),
		);
		expect(result.data).toMatchObject({ year: null, startDate: null });
	},
);
test("invalid search logs field paths without search strings or response bodies", async () => {
	const logs: string[] = [];
	const diagnosticLogger = pino(
		{ level: "warn" },
		{ write: (line) => logs.push(line) },
	);
	const api = new BangumiClient({
		logger: diagnosticLogger,
		fetch: async () =>
			Response.json({
				total: 1,
				limit: 10,
				offset: 0,
				data: [{ ...subject(), date: 2026 }],
			}),
	});
	cleanup.push(() => api.close());
	await expect(
		api.search("private query", 1, 10, signal()),
	).rejects.toMatchObject({
		failure: { code: "invalid-response" },
	});
	expect(logs.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({
			event: "bangumi.response_invalid",
			operation: "search",
			reason: "schema",
			issues: expect.arrayContaining([
				expect.objectContaining({ path: "/data/0/date" }),
			]),
		}),
	);
	expect(logs.join("")).not.toContain("private query");
	expect(logs.join("")).not.toContain(subject().name);
	expect(logs.join("")).not.toContain(subject().summary);
});
test.each([
	{ limit: 20 },
	{ offset: 10 },
	{ data: Array.from({ length: 11 }, () => subject()) },
	{ data: [{ ...subject(), name: "", name_cn: "" }] },
	{ data: [{ ...subject(), type: 1 }] },
])(
	"search still rejects invalid pagination and subjects: %j",
	async (overrides) => {
		await expect(
			client(async () =>
				Response.json({
					total: 20,
					limit: 10,
					offset: 0,
					data: [subject()],
					...overrides,
				}),
			).search("Frieren", 1, 10, signal()),
		).rejects.toMatchObject({
			failure: { code: "invalid-response" },
		});
	},
);
test.each([
	{
		page: 1,
		total: 120,
		offsets: [0, 20, 40],
		limits: [20, 20, 10],
		count: 50,
	},
	{
		page: 2,
		total: 95,
		offsets: [50, 70, 90],
		limits: [20, 20, 10],
		count: 45,
	},
	{ page: 1, total: 5, offsets: [0], limits: [20], count: 5 },
	{ page: 1, total: 0, offsets: [0], limits: [20], count: 0 },
])(
	"assembles logical pages across the live 20-item cap: %j",
	async ({ page, total, offsets, limits, count }) => {
		vi.useFakeTimers();
		const starts: number[] = [];
		const fetcher = vi.fn<typeof fetch>(async (input) => {
			starts.push(Date.now());
			const url = new URL((input as Request).url);
			const offset = Number(url.searchParams.get("offset"));
			const limit = Math.min(20, Number(url.searchParams.get("limit")));
			return Response.json({
				total,
				limit,
				offset,
				data: Array.from(
					{ length: Math.max(0, Math.min(limit, total - offset)) },
					(_, index) => ({
						...subject(offset + index + 1),
						date: null,
					}),
				),
			});
		});
		const pending = client(fetcher).search("Frieren", page, 50, signal());
		await vi.advanceTimersByTimeAsync(3000);
		const result = await pending;
		expect(result.items).toHaveLength(count);
		expect(result.items.map((item) => item.id)).toEqual(
			Array.from({ length: count }, (_, i) => (page - 1) * 50 + i + 1),
		);
		expect(result).toMatchObject({
			page,
			perPage: 50,
			hasNextPage: (page - 1) * 50 + count < total,
		});
		const urls = fetcher.mock.calls.map(
			([input]) => new URL((input as Request).url),
		);
		expect(urls.map((url) => Number(url.searchParams.get("offset")))).toEqual(
			offsets,
		);
		expect(urls.map((url) => Number(url.searchParams.get("limit")))).toEqual(
			limits,
		);
		for (let i = 1; i < starts.length; i++)
			expect((starts[i] ?? 0) - (starts[i - 1] ?? 0)).toBeGreaterThanOrEqual(
				1000,
			);
	},
);
test("canceling a multi-request search prevents remaining wire pages", async () => {
	vi.useFakeTimers();
	const controller = new AbortController();
	const fetcher = vi.fn<typeof fetch>(async () => {
		controller.abort();
		return Response.json({
			total: 100,
			limit: 20,
			offset: 0,
			data: Array.from({ length: 20 }, (_, i) => subject(i + 1)),
		});
	});
	await expect(
		client(fetcher).search("Frieren", 1, 50, controller.signal),
	).rejects.toBeDefined();
	await vi.advanceTimersByTimeAsync(3000);
	expect(fetcher).toHaveBeenCalledTimes(1);
});
test("search and detail share a strict one-request-per-second queue", async () => {
	vi.useFakeTimers();
	const fetcher = transport();
	const api = client(fetcher);
	await api.get(400602, signal());
	const next = api.search("Frieren", 1, 10, signal());
	await vi.advanceTimersByTimeAsync(999);
	expect(fetcher).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(1);
	await next;
	expect(fetcher).toHaveBeenCalledTimes(2);
});
test.each(["120", new Date(Date.now() + 120000).toUTCString()])(
	"429 honors Retry-After %s across different requests",
	async (retryAfter) => {
		vi.useFakeTimers();
		const fetcher = vi.fn<typeof fetch>(
			async () =>
				new Response("slow down", {
					status: 429,
					headers: { "Retry-After": retryAfter },
				}),
		);
		const api = client(fetcher);
		const now = Date.now();
		await expect(api.get(1, signal())).rejects.toMatchObject({
			failure: { code: "rate-limited" },
		});
		await expect(api.search("other", 1, 10, signal())).rejects.toMatchObject({
			failure: { code: "rate-limited", retryAt: expect.any(Number) },
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(120001);
		fetcher.mockImplementation(async () => Response.json(subject()));
		await expect(api.get(400602, signal())).resolves.toMatchObject({
			id: 400602,
		});
		expect(Date.now()).toBeGreaterThan(now + 120000);
	},
);
test("429 without valid Retry-After defaults to one minute, including already queued requests", async () => {
	vi.useFakeTimers();
	const fetcher = vi.fn<typeof fetch>(
		async () =>
			new Response(null, {
				status: 429,
				headers: { "Retry-After": "invalid" },
			}),
	);
	const api = client(fetcher);
	const first = expect(api.get(1, signal())).rejects.toMatchObject({
		failure: { code: "rate-limited" },
	});
	const queued = expect(api.get(2, signal())).rejects.toMatchObject({
		failure: { retryAt: Date.now() + 60000 },
	});
	await first;
	await vi.advanceTimersByTimeAsync(1000);
	await queued;
	expect(fetcher).toHaveBeenCalledTimes(1);
});
test("queued cancellation and shutdown never dispatch canceled requests", async () => {
	vi.useFakeTimers();
	const fetcher = transport();
	const api = client(fetcher);
	await api.get(400602, signal());
	const controller = new AbortController();
	const canceled = expect(api.get(2, controller.signal)).rejects.toBeDefined();
	controller.abort();
	await canceled;
	const stopped = expect(api.get(3, signal())).rejects.toBeDefined();
	await api.close();
	await stopped;
	await vi.advanceTimersByTimeAsync(2000);
	expect(fetcher).toHaveBeenCalledTimes(1);
});
test("running request timeout aborts fetch and releases the queue", async () => {
	vi.useFakeTimers();
	const fetcher = vi.fn<typeof fetch>(
		async (input) =>
			new Promise((_resolve, reject) => {
				const request = input as Request;
				request.signal.addEventListener(
					"abort",
					() => reject(request.signal.reason),
					{ once: true },
				);
			}),
	);
	const api = client(fetcher);
	const timed = expect(api.get(1, signal())).rejects.toMatchObject({
		failure: { code: "unavailable" },
	});
	await vi.advanceTimersByTimeAsync(8000);
	await timed;
	const request = fetcher.mock.calls[0]?.[0] as Request;
	expect(request.signal.aborted).toBe(true);
});
test.each([
	{ ...subject(), type: 1 },
	{ ...subject(), name: "", name_cn: "" },
	{ ...subject(), rating: { score: 99 } },
	{ ...subject(), id: 9 },
])("rejects invalid detail without caching it", async (raw) => {
	await expect(
		client(async () => Response.json(raw)).get(400602, signal()),
	).rejects.toMatchObject({ failure: { code: "invalid-response" } });
});
test("404 is not retried", async () => {
	const fetcher = vi.fn<typeof fetch>(
		async () => new Response(null, { status: 404 }),
	);
	await expect(client(fetcher).get(9, signal())).rejects.toMatchObject({
		failure: { code: "not-found" },
	});
	expect(fetcher).toHaveBeenCalledTimes(1);
});
test("resolves qualified IDs and supported subject URLs without treating other hosts as Bangumi", () => {
	const provider = new BangumiProvider(client(transport()));
	for (const host of ["bgm.tv", "bangumi.tv", "chii.in"])
		expect(
			provider.resolveReference(`https://${host}/subject/400602`),
		).toMatchObject({ provider: "bangumi", id: "400602" });
	for (const input of [
		"https://evil.test/subject/400602",
		"0",
		"9007199254740992",
		"https://bgm.tv:3000/subject/1",
	])
		expect(provider.resolveReference(input)).toBeNull();
});
test("HTTP independent searches and details use isolated persistent snapshots and project IDs", async () => {
	const dir = await mkdtemp(join(tmpdir(), "anishelf-bangumi-"));
	cleanup.push(() => rm(dir, { recursive: true, force: true }));
	const fetcher = transport();
	const api = client(fetcher);
	const provider = new BangumiProvider(api);
	let database = ApplicationDatabase.open(dir);
	const module = async () =>
		createMetadataModule({
			dataDir: dir,
			store: database.metadata,
			providers: [provider],
			defaultProvider: "bangumi",
			artworkHosts: ["lain.bgm.tv"],
			logger,
		});
	let metadata = await module();
	const app = createHttpApp({
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
		metadata,
	});
	cleanup.push(() => app.close());
	try {
		const url = "/api/metadata/search?query=Frieren";
		const [first, second] = await Promise.all([
			app.inject({ url }),
			app.inject({ url }),
		]);
		expect(first.statusCode).toBe(200);
		expect(second.statusCode).toBe(200);
		expect(fetcher).toHaveBeenCalledTimes(1);
		const work = first.json().data.items[0];
		expect(work.reference.id).toMatch(/^[a-f0-9-]{36}$/);
		expect(work.reference).not.toHaveProperty("provider");
		const resolved = await app.inject({
			url: "/api/metadata/reference?value=https://bgm.tv/subject/400602",
		});
		expect(resolved.json()).toEqual(work.reference);
		const details = await app.inject({
			url: `/api/metadata/${work.reference.id}`,
		});
		expect(details.statusCode).toBe(200);
		expect(details.json().data).toMatchObject({
			reference: work.reference,
			averageScore: 87,
			episodeCount: 28,
			status: null,
			nextAiringEpisode: null,
			startDate: { year: 2023, month: 9, day: 29 },
		});
		expect(fetcher).toHaveBeenCalledTimes(2);
		const otherId = database.metadata.identify({
			provider: "anilist",
			mediaType: "anime",
			id: "400602",
		});
		expect(otherId).not.toBe(work.reference.id);
		expect(
			(
				await app.inject({
					url: "/api/metadata/search?provider=unknown&query=Frieren",
				})
			).statusCode,
		).toBe(400);
		await metadata.close();
		database.close();
		database = ApplicationDatabase.open(dir);
		metadata = await module();
		const cached = await metadata.get(work.reference, { cachedOnly: true });
		expect(cached.snapshotId).toBe(details.json().snapshotId);
		expect(
			(await metadata.search({ query: "Frieren" }, { cachedOnly: true })).data
				.items[0]?.reference,
		).toEqual(work.reference);
		expect(fetcher).toHaveBeenCalledTimes(2);
	} finally {
		await metadata.close();
		database.close();
	}
});

test("transient upstream errors share a cooldown instead of being retried inline", async () => {
	const fetcher = vi.fn<typeof fetch>(
		async () => new Response(null, { status: 503 }),
	);
	const api = client(fetcher);
	await expect(api.get(1, signal())).rejects.toMatchObject({
		failure: { code: "unavailable", retryAt: expect.any(Number) },
	});
	await expect(api.get(2, signal())).rejects.toMatchObject({
		failure: { code: "unavailable" },
	});
	expect(fetcher).toHaveBeenCalledTimes(1);
});
test("malformed JSON is rejected as invalid metadata", async () => {
	await expect(
		client(async () => new Response("{bad json")).get(1, signal()),
	).rejects.toMatchObject({ failure: { code: "invalid-response" } });
});
test("bounds the request queue and cancels its pending work on shutdown", async () => {
	vi.useFakeTimers();
	const fetcher = transport();
	const api = client(fetcher);
	await api.get(400602, signal());
	const pending = Array.from({ length: 50 }, () =>
		api.get(400602, signal()).catch(() => null),
	);
	await expect(api.get(400602, signal())).rejects.toMatchObject({
		failure: { code: "busy" },
	});
	await api.close();
	await Promise.all(pending);
	expect(fetcher).toHaveBeenCalledTimes(1);
});
test("a failed stale refresh preserves the snapshot and communicates the shared retry time", async () => {
	const dir = await mkdtemp(join(tmpdir(), "anishelf-bangumi-stale-"));
	cleanup.push(() => rm(dir, { recursive: true, force: true }));
	const database = ApplicationDatabase.openMemory();
	cleanup.push(async () => database.close());
	const fetcher = transport();
	const api = client(fetcher);
	const metadata = await createMetadataModule({
		dataDir: dir,
		store: database.metadata,
		providers: [new BangumiProvider(api)],
		defaultProvider: "bangumi",
		artworkHosts: ["lain.bgm.tv"],
		logger,
	});
	cleanup.push(() => metadata.close());
	const reference = metadata.resolveReference("bangumi:anime:400602");
	const original = await metadata.get(reference);
	const stored = database.metadata.current("bangumi:anime:400602");
	if (!stored) throw new Error("Expected cached snapshot.");
	database.metadata.save({ ...stored, expiresAt: 0 });
	fetcher.mockImplementation(
		async () =>
			new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
	);
	const stale = await metadata.get(reference);
	expect(stale.stale).toBe(true);
	expect(stale.data).toEqual(original.data);
	await vi.waitFor(
		() =>
			expect(metadata.snapshot(original.snapshotId).refreshError?.code).toBe(
				"rate-limited",
			),
		{ timeout: 2500 },
	);
	const retained = await metadata.get(reference);
	expect(retained.snapshotId).toBe(original.snapshotId);
	expect(retained.refreshError?.retryAt).toBeGreaterThan(Date.now() + 110000);
	await expect(metadata.search({ query: "different" })).rejects.toMatchObject({
		failure: { code: "rate-limited" },
	});
	expect(fetcher).toHaveBeenCalledTimes(2);
});
