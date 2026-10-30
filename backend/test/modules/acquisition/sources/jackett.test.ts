import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { MockAgent } from "undici";
import { afterEach, expect, test } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import { SourcesApplication } from "../../../../src/modules/acquisition/sources/application/application.js";
import { SourceRequestGate } from "../../../../src/modules/acquisition/sources/infrastructure/request-gate.js";
import { JackettClient } from "../../../../src/modules/acquisition/sources/jackett/client.js";
import { JackettConfigurationFile } from "../../../../src/modules/acquisition/sources/jackett/configuration.js";
import { JackettConnection } from "../../../../src/modules/acquisition/sources/jackett/connection.js";
import { JackettTransport } from "../../../../src/modules/acquisition/sources/jackett/transport.js";
import { titleQueries } from "../../../../src/modules/acquisition/sources/jackett/validation.js";
import {
	capabilities,
	document,
	indexers,
	releases,
} from "../../../../src/modules/acquisition/sources/jackett/xml.js";
import { RssTransport } from "../../../../src/modules/acquisition/sources/rss/transport.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
const secret = "private-test-api-key";
const logger = pino({ level: "silent" });
const signal = () => new AbortController().signal;
const caps =
	'<caps><limits max="100" default="2"/><searching><search available="yes" supportedParams="q"/></searching></caps>';
const magnet = `magnet:?xt=urn:btih:${"a".repeat(40)}`;
const item = (id: string) =>
	`<item><title>Example Season 2 ${id}</title><guid>${id}</guid><enclosure type="application/x-bittorrent" url="${magnet}"/><torznab:attr name="seeders" value="0"/></item>`;
const page = (
	items: string,
	response = '<torznab:response offset="0" total="1"/>',
) =>
	`<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${response}${items}</channel></rss>`;
function wire(options: { now?: () => number } = {}) {
	const agent = new MockAgent();
	agent.disableNetConnect();
	const transport = new JackettTransport(
		"http://jackett:9117",
		secret,
		"generation",
		logger,
		agent,
	);
	cleanup.push(() => transport.close());
	const pool = agent.get("http://jackett:9117");
	const api = (params: Record<string, string>, body: string, status = 200) =>
		pool
			.intercept({
				path: `/api/v2.0/indexers/example/results/torznab/api?${new URLSearchParams({ ...params, apikey: secret })}`,
				method: "GET",
			})
			.reply(status, body);
	return {
		agent,
		pool,
		transport,
		api,
		client: new JackettClient(transport, new SourceRequestGate(0), options),
	};
}
const plan = {
	generation: "generation",
	indexerId: "example",
	titles: ["Example Season 2"],
};

test("Torznab normalizes zero versus unknown counts and season-preserving titles", () => {
	expect(capabilities(caps)).toEqual({ search: true, limit: 2 });
	expect(
		titleQueries([" Example Season 2 ", "Example Season 2", "Example II"]),
	).toEqual(["Example Season 2", "Example II"]);
	expect(
		titleQueries([
			" Ｅｘａｍｐｌｅ   Season 2 ",
			"example season 2",
			"Example II",
		]),
	).toEqual(["Example Season 2", "Example II"]);
	expect(() => titleQueries(["Example\nSeason 2"])).toThrow(
		expect.objectContaining({ code: "invalid_query" }),
	);
	const result = releases(
		page(item("one")),
		{ id: "example", generation: "g" },
		() => ({ kind: "magnet", uri: magnet }),
	);
	expect(result.entries[0]).toMatchObject({
		seeders: 0,
		peers: null,
		size: null,
		hash: "a".repeat(40),
		downloadUrl: null,
	});
	expect(indexers("<indexers/>")).toEqual([]);
	expect(
		indexers(
			'<indexers><indexer id="example" configured="true"><title>Example</title></indexer><indexer id="other" configured="false"/></indexers>',
		),
	).toEqual([{ id: "example", name: "Example" }]);
});

test.each([
	[100, "authentication_failed"],
	[201, "unsupported_capability"],
	[429, "rate_limited"],
	[900, "upstream_failure"],
])("HTTP 200 error XML %s remains a typed failure", (code, message) => {
	expect(() =>
		document(`<error code="${code}" description="${secret}"/>`),
	).toThrow(expect.objectContaining({ code: message }));
});
test.each(["<rss>", '<!DOCTYPE rss [<!ENTITY a "x">]><rss/>', "<html/>"])(
	"malformed or non-feed XML fails: %s",
	(xml) => {
		expect(() =>
			releases(xml, { id: "example", generation: "g" }, () => null),
		).toThrow(expect.objectContaining({ code: "malformed_response" }));
	},
);

test("bounded pagination de-duplicates aliases and detects a repeated page", async () => {
	const f = wire();
	f.api({ t: "caps" }, caps);
	f.api(
		{ t: "search", q: "Example Season 2", limit: "2", offset: "0" },
		page(item("one"), '<torznab:response offset="0" total="9"/>'),
	);
	f.api(
		{ t: "search", q: "Example Season 2", limit: "2", offset: "1" },
		page(item("one"), '<torznab:response offset="1" total="9"/>'),
	);
	const result = await f.client.search(plan, signal());
	expect(result.entries).toHaveLength(1);
	expect(result.coverage).toMatchObject({
		limited: true,
		reason: "repeated_page",
		pages: 2,
	});
	f.agent.assertNoPendingInterceptors();
});
test("empty search is cached briefly; missing pagination remains limited after expiry", async () => {
	let now = 1000;
	const f = wire({ now: () => now });
	f.api({ t: "caps" }, caps);
	await f.client.capabilities("example", signal());
	f.api(
		{ t: "search", q: "Example Season 2", limit: "2", offset: "0" },
		page("", ""),
	);
	expect((await f.client.search(plan, signal())).outcome).toBe("no_match");
	expect((await f.client.search(plan, signal())).outcome).toBe("no_match");
	now += 5 * 60_000;
	f.api(
		{ t: "search", q: "Example Season 2", limit: "2", offset: "0" },
		page(item("one"), ""),
	);
	expect((await f.client.search(plan, signal())).coverage.reason).toBe(
		"missing_pagination",
	);
	f.agent.assertNoPendingInterceptors();
});

test("concurrent equivalent searches share capabilities and pages without renewing observations", async () => {
	let now = 1000;
	const f = wire({ now: () => now });
	f.api({ t: "caps" }, caps).delay(10);
	f.api(
		{ t: "search", q: "Example Season 2", limit: "2", offset: "0" },
		page(item("one")),
	).delay(10);
	const [first, second] = await Promise.all([
		f.client.search(plan, signal()),
		f.client.search(plan, signal()),
	]);
	expect(first).toEqual(second);
	expect(first.entries[0]?.seedersObservedAt).toBe(1000);
	if (first.entries[0]?.download?.kind === "magnet")
		first.entries[0].download.uri = "mutated";
	now += 9 * 60_000;
	const cached = await f.client.search(
		{ ...plan, titles: ["example  season 2", "Ｅｘａｍｐｌｅ Season 2"] },
		signal(),
	);
	expect(cached.entries[0]).toMatchObject({
		seedersObservedAt: 1000,
		download: { kind: "magnet", uri: magnet },
	});
	f.api(
		{ t: "search", q: "Example Season 2", limit: "2", offset: "0" },
		page(item("one")),
	);
	now += 60_000;
	expect((await f.client.search(plan, signal())).entries[0]).toMatchObject({
		seedersObservedAt: now,
	});
	f.agent.assertNoPendingInterceptors();
});

test("business acceptance stops progressive search and later full collection completes coverage", async () => {
	const f = wire();
	f.api({ t: "caps" }, caps);
	f.api(
		{ t: "search", q: "Example Season 2", limit: "2", offset: "0" },
		page(
			"<item><title>Example Episode 1</title><guid>one</guid></item>",
			'<torznab:response offset="0" total="2"/>',
		),
	);
	const input = { ...plan, titles: [...plan.titles, "Example II"] };
	const accepted = await f.client.search(input, signal(), (entries) =>
		entries.some((entry) => entry.title === "Example Episode 1"),
	);
	expect(accepted.coverage).toEqual({
		limited: true,
		reason: "accepted",
		pages: 1,
		queries: 1,
	});
	// A full collection reuses the accepted page, then reads the remaining page and alias.
	f.api(
		{ t: "search", q: "Example Season 2", limit: "2", offset: "1" },
		page(
			"<item><title>Example Episode 2</title><guid>two</guid></item>",
			'<torznab:response offset="1" total="2"/>',
		),
	);
	f.api(
		{ t: "search", q: "Example II", limit: "2", offset: "0" },
		page("", '<torznab:response offset="0" total="0"/>'),
	);
	const full = await f.client.search(input, signal());
	expect(full.entries).toHaveLength(2);
	expect(full.coverage).toEqual({
		limited: false,
		reason: null,
		pages: 3,
		queries: 2,
	});
	f.agent.assertNoPendingInterceptors();
});

test("nonempty unrelated pages do not stop progressive search", async () => {
	const f = wire();
	f.api({ t: "caps" }, caps);
	f.api(
		{ t: "search", q: "Example Season 2", limit: "2", offset: "0" },
		page("<item><title>Unrelated</title><guid>one</guid></item>"),
	);
	f.api(
		{ t: "search", q: "Example II", limit: "2", offset: "0" },
		page("<item><title>Expected</title><guid>two</guid></item>"),
	);
	const result = await f.client.search(
		{ ...plan, titles: [...plan.titles, "Example II"] },
		signal(),
		(entries) => entries.some((entry) => entry.title === "Expected"),
	);
	expect(result.entries).toHaveLength(2);
	expect(result.coverage.queries).toBe(2);
	f.agent.assertNoPendingInterceptors();
});

test("failed capability or page responses are never cached", async () => {
	const f = wire();
	f.api({ t: "caps" }, "<caps>");
	await expect(f.client.search(plan, signal())).rejects.toMatchObject({
		code: "malformed_response",
	});
	f.api({ t: "caps" }, caps);
	f.api(
		{ t: "search", q: "Example Season 2", limit: "2", offset: "0" },
		"<rss>",
	);
	await expect(f.client.search(plan, signal())).rejects.toMatchObject({
		code: "malformed_response",
	});
	f.api(
		{ t: "search", q: "Example Season 2", limit: "2", offset: "0" },
		page(item("one")),
	);
	expect((await f.client.search(plan, signal())).entries).toHaveLength(1);
	f.agent.assertNoPendingInterceptors();
});

test("private API requests never follow redirects or expose upstream error descriptions", async () => {
	const f = wire();
	f.pool
		.intercept({ path: /torznab/, method: "GET" })
		.reply(302, "", { headers: { location: "http://127.0.0.1/secret" } });
	await expect(
		f.transport.api("example", { t: "caps" }, signal()),
	).rejects.toThrow(expect.objectContaining({ code: "redirect_rejected" }));
	f.api({ t: "caps" }, `<error code="100" description="${secret}"/>`);
	await expect(f.client.capabilities("example", signal())).rejects.toThrow(
		expect.objectContaining({ code: "authentication_failed" }),
	);
	await expect(
		f.transport.api(null, { t: "search" }, signal()),
	).rejects.toThrow(expect.objectContaining({ code: "invalid_indexer" }));
});

test("download descriptors strip both key layouts and reconstruct only the saved endpoint", async () => {
	const f = wire();
	const descriptor = f.transport.download(
		`http://jackett:9117/dl/example/?jackett_apikey=${secret}&path=opaque_abc&file=Example`,
		"example",
	);
	expect(descriptor).toEqual({
		kind: "jackett-torrent",
		generation: "generation",
		indexerId: "example",
		path: "opaque_abc",
		file: "Example",
	});
	expect(
		f.transport.download(
			`http://jackett:9117/dl/example/${secret}/opaque_abc/Example`,
			"example",
		),
	).toEqual(descriptor);
	expect(JSON.stringify(descriptor)).not.toContain(secret);
	f.pool
		.intercept({
			path: `/dl/example/?${new URLSearchParams({ path: "opaque_abc", file: "Example", jackett_apikey: secret })}`,
			method: "GET",
		})
		.reply(302, "", { headers: { location: magnet } });
	expect(await f.transport.readTorrent(descriptor, signal())).toEqual({
		kind: "magnet",
		uri: magnet,
	});
	await expect(
		f.transport.readTorrent(
			{
				...descriptor,
				kind: "jackett-torrent",
				generation: "old",
				indexerId: "example",
				path: "opaque",
				file: "Example",
			},
			signal(),
		),
	).rejects.toThrow(expect.objectContaining({ code: "source_conflict" }));
});
test.each([
	"http://127.0.0.1/torrent",
	"http://jackett:9117/admin",
	"http://jackett:9117/dl/other/?path=opaque",
	`https://public.example/torrent?apikey=${secret}`,
	`magnet:?xt=urn:btih:${"b".repeat(40)}&dn=${secret}`,
])("reject unsafe locator %s", (input) => {
	expect(() => wire().transport.download(input, "example")).toThrow(
		expect.objectContaining({ code: "invalid_download_locator" }),
	);
});

test("public torrent redirects use RSS transport without Jackett credentials", async () => {
	const agent = new MockAgent();
	agent.disableNetConnect();
	const publicAgent = new MockAgent();
	publicAgent.disableNetConnect();
	const transport = new JackettTransport(
		"http://jackett:9117",
		secret,
		"generation",
		logger,
		agent,
		new RssTransport(publicAgent),
	);
	cleanup.push(() => transport.close());
	const desc = transport.download(
		"http://jackett:9117/dl/example/?path=opaque",
		"example",
	);
	agent
		.get("http://jackett:9117")
		.intercept({ path: /^\/dl\// })
		.reply(302, "", {
			headers: { location: "https://public.example/legal.torrent" },
		});
	publicAgent
		.get("https://public.example")
		.intercept({
			path: "/legal.torrent",
			headers: (headers) => !JSON.stringify(headers).includes(secret),
		})
		.reply(200, "torrent-bytes");
	const result = await transport.readTorrent(desc, signal());
	expect(result.kind).toBe("bytes");
	if (result.kind === "bytes")
		expect(Buffer.from(result.bytes).toString()).toBe("torrent-bytes");
	publicAgent.assertNoPendingInterceptors();
});

test("shared gate queues excess RSS plus Jackett work and serializes each indexer", async () => {
	const gate = new SourceRequestGate(0);
	const started: string[] = [];
	let finish!: () => void;
	const pending = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const a = gate.run("jackett:example", signal(), () => {
		started.push("first-indexer");
		return pending;
	});
	const b = gate.run(null, signal(), () => {
		started.push("rss");
		return pending;
	});
	const c = gate.run(null, signal(), async () => started.push("queued-rss"));
	const d = gate.run("jackett:example", signal(), async () =>
		started.push("queued-indexer"),
	);
	expect(started).toEqual(["first-indexer", "rss"]);
	finish();
	await Promise.all([a, b, c, d]);
	expect(started).toEqual([
		"first-indexer",
		"rss",
		"queued-rss",
		"queued-indexer",
	]);
	await expect(gate.run(null, signal(), async () => "ok")).resolves.toBe("ok");
});

test("private config survives restart; generations fence stale queries and unified snapshots", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-jackett-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const store = new JackettConfigurationFile(directory);
	const logs: string[] = [];
	const logger = pino({ level: "trace" }, { write: (line) => logs.push(line) });
	const f = wire();
	let generation = "";
	const connection = new JackettConnection(
		store,
		(config) => {
			generation = config.generation;
			return new JackettClient(
				new JackettTransport(
					"http://jackett:9117",
					secret,
					generation,
					logger,
					f.agent,
				),
				new SourceRequestGate(0),
			);
		},
		logger,
	);
	cleanup.push(() => connection.close());
	await connection.initialize();
	const first = await connection.save({
		generation: connection.settings().generation,
		url: "http://jackett:9117",
		origin: "external",
		apiKey: secret,
		indexers: ["example"],
	});
	const database = ApplicationDatabase.openMemory();
	cleanup.push(async () => database.close());
	const options = {
		store: database.acquisition,
		jackett: connection,
		rss: {
			store: {
				feed: () => null,
				saveFeed: () => {
					throw new Error("query must not persist as RSS");
				},
			},
			transport: {
				fetch: async () => ({ xml: null, etag: null, lastModified: null }),
				close: async () => {},
			},
			parse: () => [],
			normalizeUrl: (s: string) => s,
			logger,
		},
		logger,
	};
	const sources = new SourcesApplication(options);
	cleanup.push(() => sources.close());
	f.api({ t: "caps" }, caps);
	f.api(
		{ t: "search", q: "Example Season 2", limit: "2", offset: "0" },
		page(item("one")),
	);
	const reference = sources.referenceFor({
		kind: "search",
		providerId: plan.indexerId,
		titles: plan.titles,
		connectionRevision: first.generation,
	});
	expect(Object.keys(reference)).toEqual(["id"]);
	const snapshot = await sources.refresh(reference);
	expect(sources.isCurrent(snapshot)).toBe(true);
	sources.publish(snapshot);
	expect(sources.snapshot(snapshot.id)).toEqual(snapshot);
	const next = await connection.save({
		generation: first.generation,
		url: "http://jackett:9117",
		origin: "external",
		indexers: ["example"],
	});
	expect(next.hasApiKey).toBe(true);
	expect(sources.isCurrent(snapshot)).toBe(false);
	await expect(sources.refresh(reference)).rejects.toThrow(
		expect.objectContaining({ code: "source_conflict" }),
	);
	await expect(connection.clear(first.generation)).rejects.toThrow(
		expect.objectContaining({ code: "source_conflict" }),
	);
	expect(
		(await stat(join(directory, "acquisition/jackett.json"))).mode & 0o777,
	).toBe(0o600);
	expect(
		JSON.parse(
			await readFile(join(directory, "acquisition/jackett.json"), "utf8"),
		).connection.apiKey,
	).toBe(secret);
	const reopened = new JackettConnection(store, () => f.client, logger);
	await reopened.initialize();
	expect(reopened.settings()).toEqual(next);
	cleanup.push(() => reopened.close());
	expect(JSON.stringify([next, logs])).not.toContain(secret);
	const cleared = await connection.save({
		generation: next.generation,
		url: "http://jackett:9117",
		origin: "external",
		indexers: ["example"],
		apiKey: null,
	});
	expect(cleared.ready).toBe(false);
});

test("response bounds reject excess XML items and bytes, and oversized torrent payloads", async () => {
	const f = wire();
	expect(() =>
		releases(
			page(item("one").repeat(1001)),
			{ id: "example", generation: "g" },
			() => null,
		),
	).toThrow(expect.objectContaining({ code: "item_limit" }));
	f.api({ t: "caps" }, "x".repeat(5 * 1024 * 1024 + 1));
	await expect(
		f.transport.api("example", { t: "caps" }, signal()),
	).rejects.toMatchObject({ code: "response_too_large" });
	f.pool
		.intercept({ path: /^\/dl\// })
		.reply(200, "x".repeat(10 * 1024 * 1024 + 1));
	await expect(
		f.transport.readTorrent(
			f.transport.download(
				"http://jackett:9117/dl/example/?path=opaque",
				"example",
			),
			signal(),
		),
	).rejects.toMatchObject({ code: "response_too_large" });
});

test("retry hints prevent immediate requests and spacing waits can be cancelled", async () => {
	const f = wire();
	let now = Date.now();
	const gate = new SourceRequestGate(5000, () => now);
	f.pool
		.intercept({ path: /torznab/ })
		.reply(429, "", { headers: { "retry-after": "60" } });
	await expect(
		gate.run("example", signal(), () =>
			f.transport.api("example", { t: "caps" }, signal()),
		),
	).rejects.toMatchObject({ code: "rate_limited" });
	await expect(
		gate.run("example", signal(), async () => {}),
	).rejects.toMatchObject({ code: "rate_limited" });
	now += 61000;
	await gate.run("example", signal(), async () => {});
	const controller = new AbortController();
	const waiting = gate.run("example", controller.signal, async () => {});
	controller.abort();
	await expect(waiting).rejects.toMatchObject({ code: "request_cancelled" });
});

test("generation rotation cancels a request waiting for indexer spacing", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-jackett-race-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const f = wire();
	const gate = new SourceRequestGate();
	const connection = new JackettConnection(
		new JackettConfigurationFile(directory),
		(configuration) =>
			new JackettClient(
				new JackettTransport(
					"http://jackett:9117",
					secret,
					configuration.generation,
					logger,
					f.agent,
				),
				gate,
			),
		pino({ level: "silent" }),
	);
	cleanup.push(() => connection.close());
	await connection.initialize();
	const saved = await connection.save({
		generation: connection.settings().generation,
		url: "http://jackett:9117",
		origin: "external",
		apiKey: secret,
		indexers: ["example"],
	});
	f.api({ t: "caps" }, caps);
	await connection.probe(saved.generation, "example");
	const pending = connection.search({ ...plan, generation: saved.generation });
	const assertion = expect(pending).rejects.toMatchObject({
		code: "source_conflict",
	});
	await connection.clear(saved.generation);
	await assertion;
	f.agent.assertNoPendingInterceptors();
});

test("page limit bounds work and lower advertised limits are used", async () => {
	const f = wire();
	f.api(
		{ t: "caps" },
		caps.replace('max="100" default="2"', 'max="1" default="1"'),
	);
	for (let offset = 0; offset < 3; offset++)
		f.api(
			{
				t: "search",
				q: "Example Season 2",
				limit: "1",
				offset: String(offset),
			},
			page(
				`<item><title>Episode ${offset}</title><guid>${offset}</guid></item>`,
				`<torznab:response offset="${offset}" total="50"/>`,
			),
		);
	const result = await f.client.search(plan, signal());
	expect(result.entries).toHaveLength(3);
	expect(result.coverage).toMatchObject({
		limited: true,
		reason: "page_limit",
		pages: 3,
	});
	f.agent.assertNoPendingInterceptors();
});

test.each([
	"http://jackett:9117/dl/example/?path=one&path=two",
	"http://jackett:9117/dl/example/?path=opaque&apikey=wrong",
	`https://public.example/%70rivate-test-api-key/torrent`,
])("reject ambiguous or encoded credential locator %s", (input) => {
	expect(() => wire().transport.download(input, "example")).toThrow(
		expect.objectContaining({ code: "invalid_download_locator" }),
	);
});

test("error and redirect responses release their bodies without an unhandled stream error", async () => {
	const server = createServer((request, response) => {
		const query = new URL(request.url ?? "/", "http://fixture").searchParams;
		switch (query.get("q")) {
			case "redirect":
				response.writeHead(302, { location: "/elsewhere" });
				break;
			case "unauthorized":
				response.writeHead(401);
				break;
			case "limited":
				response.writeHead(429, { "retry-after": "120" });
				break;
			case "encoded":
				response.writeHead(200, { "content-encoding": "gzip" });
				break;
			default:
				response.writeHead(502);
		}
		response.end();
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	cleanup.push(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing fixture address.");
	const logs: Record<string, unknown>[] = [];
	const transport = new JackettTransport(
		`http://127.0.0.1:${address.port}`,
		secret,
		"generation",
		pino({ level: "warn" }, { write: (line) => logs.push(JSON.parse(line)) }),
	);
	cleanup.push(() => transport.close());
	const search = (q: string) =>
		transport.api(
			"example",
			{ t: "search", q, limit: "10", offset: "0" },
			signal(),
		);
	await expect(search("failure")).rejects.toMatchObject({
		code: "upstream_failure",
	});
	await expect(search("redirect")).rejects.toMatchObject({
		code: "redirect_rejected",
	});
	await expect(search("unauthorized")).rejects.toMatchObject({
		code: "authentication_failed",
	});
	await expect(search("limited")).rejects.toMatchObject({
		code: "rate_limited",
	});
	await expect(search("encoded")).rejects.toMatchObject({
		code: "upstream_failure",
	});
	// The discarded body reports its abort on a later tick; crashing here fails the run.
	await new Promise((resolve) => setTimeout(resolve, 50));
	expect(
		logs
			.filter((entry) => entry.event === "acquisition.upstream_status")
			.map((entry) => entry.statusCode),
	).toEqual([502, 401, 429, 200]);
	expect(logs.at(-1)).toMatchObject({
		code: "upstream_failure",
		contentType: null,
	});
});
