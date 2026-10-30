import pino from "pino";
import { MockAgent } from "undici";
import { afterEach, expect, test, vi } from "vitest";
import {
	SourceContent,
	type SourceTorrentTransport,
} from "../../../../src/modules/acquisition/sources/application/content.js";
import { SourceError } from "../../../../src/modules/acquisition/sources/domain/model.js";
import { SourceRequestGate } from "../../../../src/modules/acquisition/sources/infrastructure/request-gate.js";
import {
	jackettConnectionKey,
	sourceOriginKey,
} from "../../../../src/modules/acquisition/sources/infrastructure/request-keys.js";
import { sourceRetryAt } from "../../../../src/modules/acquisition/sources/infrastructure/retry-after.js";
import type {
	SourceDownload,
	SourceLifecycleStore,
} from "../../../../src/modules/acquisition/sources/infrastructure/store.js";
import type { JackettConnection } from "../../../../src/modules/acquisition/sources/jackett/connection.js";
import { provisionPublicSite } from "../../../../src/modules/acquisition/sources/jackett/provisioning.js";
import { JackettTransport } from "../../../../src/modules/acquisition/sources/jackett/transport.js";
import { RssTransport } from "../../../../src/modules/acquisition/sources/rss/transport.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
const signal = () => new AbortController().signal;
const logger = pino({ level: "silent" });
const validators = { etag: null, lastModified: null };

test("Retry-After uses seconds, HTTP dates and a conservative malformed-header fallback", () => {
	const now = Date.parse("2026-10-24T00:00:00Z");
	expect(sourceRetryAt("120", now)).toBe(now + 120_000);
	expect(sourceRetryAt("Sat, 24 Oct 2026 00:03:00 GMT", now)).toBe(
		now + 180_000,
	);
	expect(sourceRetryAt("Fri, 23 Oct 2026 00:00:00 GMT", now)).toBe(now);
	expect(sourceRetryAt("invalid", now)).toBe(now + 60_000);
	expect(sourceOriginKey("https://example.org/feed?token=private")).toBe(
		sourceOriginKey("https://example.org/file.torrent"),
	);
	expect(
		sourceOriginKey("https://example.org/feed?token=private"),
	).not.toContain("example");
});

test.each([429, 503])(
	"RSS HTTP %s cools down feed and torrent requests for the whole origin",
	async (status) => {
		const agent = new MockAgent();
		agent.disableNetConnect();
		const gate = new SourceRequestGate(0);
		const transport = new RssTransport(agent, gate);
		cleanup.push(() => transport.close());
		agent
			.get("https://feeds.example.org")
			.intercept({ path: "/rss" })
			.reply(status, "", { headers: { "retry-after": "120" } });
		await expect(
			transport.fetch("https://feeds.example.org/rss", validators, signal()),
		).rejects.toMatchObject({ code: "rate_limited" });
		await expect(
			transport.read("https://feeds.example.org/file.torrent", signal()),
		).rejects.toMatchObject({ code: "rate_limited" });
		agent
			.get("https://other.example.org")
			.intercept({ path: "/rss" })
			.reply(200, "<rss/>");
		await expect(
			transport.fetch("https://other.example.org/rss", validators, signal()),
		).resolves.toMatchObject({ xml: "<rss/>" });
		agent.assertNoPendingInterceptors();
	},
);

test("RSS redirect destinations pass their own budget before HTTP and retain original validators", async () => {
	const agent = new MockAgent();
	agent.disableNetConnect();
	const gate = new SourceRequestGate(0);
	const transport = new RssTransport(agent, gate);
	cleanup.push(() => transport.close());
	gate.cooldown(
		sourceOriginKey("https://destination.example.org"),
		Date.now() + 120_000,
	);
	agent
		.get("https://feeds.example.org")
		.intercept({ path: "/rss", headers: { "if-none-match": "feed-version" } })
		.reply(302, "", {
			headers: { location: "https://destination.example.org/rss" },
		});
	await expect(
		transport.fetch(
			"https://feeds.example.org/rss",
			{ etag: "feed-version", lastModified: null },
			signal(),
		),
	).rejects.toMatchObject({ code: "rate_limited" });
	agent.assertNoPendingInterceptors();
});

test("Jackett torrent rate limits cool down search and other indexers on the same connection", async () => {
	const agent = new MockAgent();
	agent.disableNetConnect();
	const gate = new SourceRequestGate(0);
	const transport = new JackettTransport(
		"http://jackett:9117",
		"private-key",
		"g",
		logger,
		agent,
		undefined,
		gate,
	);
	cleanup.push(() => transport.close());
	agent
		.get("http://jackett:9117")
		.intercept({ path: /^\/dl\/example\// })
		.reply(503, "", { headers: { "retry-after": "120" } });
	const descriptor = transport.download(
		"http://jackett:9117/dl/example/?path=opaque",
		"example",
	);
	await expect(
		transport.readTorrent(descriptor, signal()),
	).rejects.toMatchObject({ code: "rate_limited" });
	for (const indexer of ["example", "another"])
		await expect(
			transport.api(indexer, { t: "caps" }, signal()),
		).rejects.toMatchObject({ code: "rate_limited" });
	agent.assertNoPendingInterceptors();
});

test("public Jackett torrent redirects preserve connection cooldown ownership", async () => {
	const privateAgent = new MockAgent();
	privateAgent.disableNetConnect();
	const publicAgent = new MockAgent();
	publicAgent.disableNetConnect();
	const gate = new SourceRequestGate(0);
	const publicTransport = new RssTransport(publicAgent, gate);
	const transport = new JackettTransport(
		"http://jackett:9117",
		"private-key",
		"g",
		logger,
		privateAgent,
		publicTransport,
		gate,
	);
	cleanup.push(() => transport.close());
	privateAgent
		.get("http://jackett:9117")
		.intercept({ path: /^\/dl\/example\// })
		.reply(302, "", {
			headers: { location: "https://public.example.org/file.torrent" },
		});
	publicAgent
		.get("https://public.example.org")
		.intercept({ path: "/file.torrent" })
		.reply(429, "", { headers: { "retry-after": "120" } });
	const descriptor = transport.download(
		"http://jackett:9117/dl/example/?path=opaque",
		"example",
	);
	await expect(
		transport.readTorrent(descriptor, signal()),
	).rejects.toMatchObject({ code: "rate_limited" });
	await expect(
		transport.api("example", { t: "caps" }, signal()),
	).rejects.toMatchObject({ code: "rate_limited" });
	privateAgent.assertNoPendingInterceptors();
	publicAgent.assertNoPendingInterceptors();
});

test("Jackett applies per-hop budgets to an injected public transport without nested admission", async () => {
	const privateAgent = new MockAgent();
	privateAgent.disableNetConnect();
	const publicAgent = new MockAgent();
	publicAgent.disableNetConnect();
	const gate = new SourceRequestGate(0);
	const publicTransport = new RssTransport(publicAgent);
	const transport = new JackettTransport(
		"http://jackett:9117",
		"private-key",
		"g",
		logger,
		privateAgent,
		publicTransport,
		gate,
	);
	cleanup.push(() => transport.close());
	gate.cooldown(
		sourceOriginKey("https://blocked.example.org/"),
		Date.now() + 120_000,
	);
	privateAgent
		.get("http://jackett:9117")
		.intercept({ path: /^\/dl\/example\// })
		.reply(302, "", {
			headers: { location: "https://public.example.org/file.torrent" },
		});
	publicAgent
		.get("https://public.example.org")
		.intercept({ path: "/file.torrent" })
		.reply(302, "", {
			headers: { location: "https://blocked.example.org/file.torrent" },
		});
	const descriptor = transport.download(
		"http://jackett:9117/dl/example/?path=opaque",
		"example",
	);
	await expect(
		transport.readTorrent(descriptor, signal()),
	).rejects.toMatchObject({ code: "rate_limited" });
	privateAgent.assertNoPendingInterceptors();
	publicAgent.assertNoPendingInterceptors();
});

test("Torznab HTTP 200 throttle responses stop already queued requests before admission", async () => {
	const agent = new MockAgent();
	agent.disableNetConnect();
	const gate = new SourceRequestGate(0);
	const transport = new JackettTransport(
		"http://jackett:9117",
		"private-key",
		"g",
		logger,
		agent,
		undefined,
		gate,
	);
	cleanup.push(() => transport.close());
	agent
		.get("http://jackett:9117")
		.intercept({ path: /torznab/ })
		.reply(200, '<error code="429" description="try later"/>')
		.delay(5);
	const first = transport.api("example", { t: "caps" }, signal());
	const queued = transport.api("another", { t: "caps" }, signal());
	await Promise.all([
		expect(first).rejects.toMatchObject({ code: "rate_limited" }),
		expect(queued).rejects.toMatchObject({ code: "rate_limited" }),
	]);
	agent.assertNoPendingInterceptors();
});

test.each(["login", "config"])(
	"bundled management %s throttles cool down the same Torznab connection",
	async (throttle) => {
		const agent = new MockAgent();
		agent.disableNetConnect();
		const gate = new SourceRequestGate(0);
		const transport = new JackettTransport(
			"http://jackett:9117",
			"private-key",
			"g",
			logger,
			agent,
			undefined,
			gate,
		);
		cleanup.push(() => transport.close());
		const beforeWrite = vi.fn(async () => {});
		const request = vi.fn<typeof fetch>(async (input) => {
			if (String(input).includes("UI/Login"))
				return throttle === "login"
					? new Response(null, {
							status: 429,
							headers: { "retry-after": "120" },
						})
					: new Response(null, {
							status: 302,
							headers: { "Set-Cookie": "Jackett=secret-cookie; HttpOnly" },
						});
			if (String(input).includes("/nyaasi/config"))
				return new Response(null, {
					status: 503,
					headers: { "retry-after": "120" },
				});
			return Response.json([]);
		});
		await expect(
			provisionPublicSite({
				url: "http://jackett:9117",
				signal: signal(),
				guard: () => {},
				beforeWrite,
				request,
				gate,
			}),
		).rejects.toMatchObject({ code: "rate_limited" });
		await expect(
			transport.api("nyaasi", { t: "caps" }, signal()),
		).rejects.toMatchObject({ code: "rate_limited" });
		expect(beforeWrite).not.toHaveBeenCalled();
		expect(request).toHaveBeenCalledTimes(throttle === "login" ? 1 : 3);
	},
);

test("bundled management rechecks connection generation after waiting for a shared budget", async () => {
	const gate = new SourceRequestGate(0);
	const base = "http://jackett:9117/";
	let release!: () => void;
	const busy = gate.runMany(
		[sourceOriginKey(base), jackettConnectionKey(base)],
		signal(),
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	let current = true;
	const request = vi.fn<typeof fetch>();
	const provisioning = provisionPublicSite({
		url: base,
		signal: signal(),
		guard: () => {
			if (!current) throw new SourceError("source_conflict");
		},
		beforeWrite: async () => {},
		request,
		gate,
	});
	const stale = expect(provisioning).rejects.toMatchObject({
		code: "source_conflict",
	});
	current = false;
	release();
	await Promise.all([busy, stale]);
	expect(request).not.toHaveBeenCalled();
});

test("bundled management holds admission until its response body has drained", async () => {
	const gate = new SourceRequestGate(0);
	const base = "http://jackett:9117/";
	let close!: () => void;
	let bodyStarted!: () => void;
	const waiting = new Promise<void>((resolve) => {
		bodyStarted = resolve;
	});
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(
				new TextEncoder().encode('[{"id":"nyaasi","configured":true}]'),
			);
			close = () => controller.close();
		},
	});
	const request = vi.fn<typeof fetch>(async (input) => {
		if (String(input).includes("UI/Login"))
			return new Response(null, {
				status: 302,
				headers: { "Set-Cookie": "Jackett=secret-cookie; HttpOnly" },
			});
		bodyStarted();
		return new Response(body);
	});
	const provisioning = provisionPublicSite({
		url: base,
		signal: signal(),
		guard: () => {},
		beforeWrite: async () => {},
		request,
		gate,
	});
	await waiting;
	const next = vi.fn(async () => {});
	const queued = gate.runMany([jackettConnectionKey(base)], signal(), next);
	expect(next).not.toHaveBeenCalled();
	close();
	await Promise.all([provisioning, queued]);
	expect(next).toHaveBeenCalledTimes(1);
});

function contentFixture(jackett?: JackettConnection) {
	const downloads = new Map<string, SourceDownload>();
	const store: SourceLifecycleStore = {
		transaction: (operation) => operation(),
		download: (id) => downloads.get(id) ?? null,
		saveDownload: (value) => {
			downloads.set(value.id, value);
		},
		source: () => null,
		sources: () => [],
		saveSource: () => {},
		removeSource: () => {},
	};
	let now = 1_000;
	const read = vi.fn<SourceTorrentTransport["read"]>(
		async () => new Uint8Array([1, 2, 3]),
	);
	const shutdown = new AbortController();
	const content = new SourceContent(
		store,
		{ read, close: async () => {} },
		jackett,
		shutdown.signal,
		logger,
		undefined,
		() => now,
	);
	cleanup.push(() => content.close());
	const add = (
		id: string,
		path = "file.torrent",
		generation: string | null = null,
	) => {
		downloads.set(id, {
			id,
			sourceId: `source-${id}`,
			generation,
			descriptor: {
				kind: "public-torrent",
				url: `https://public.example.org/${path}`,
			},
		});
	};
	return {
		content,
		read,
		add,
		downloads,
		shutdown,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

test("torrent content coalesces across source references, preserves peer cancellation and bounds freshness", async () => {
	const f = contentFixture();
	f.add("one");
	f.add("two");
	let finish!: (value: Uint8Array<ArrayBuffer>) => void;
	let upstreamSignal!: AbortSignal;
	f.read.mockImplementationOnce((_url, signal) => {
		upstreamSignal = signal;
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	const controller = new AbortController();
	const first = f.content.read("one", controller.signal);
	const second = f.content.read("two", signal());
	const cancelled = expect(first).rejects.toMatchObject({
		code: "request_cancelled",
	});
	controller.abort();
	await cancelled;
	expect(upstreamSignal.aborted).toBe(false);
	finish(new Uint8Array([4, 5, 6]));
	const result = await second;
	expect(result).toEqual({ kind: "bytes", bytes: new Uint8Array([4, 5, 6]) });
	if (result.kind === "bytes") result.bytes[0] = 99;
	expect(await f.content.read("one", signal())).toEqual({
		kind: "bytes",
		bytes: new Uint8Array([4, 5, 6]),
	});
	expect(f.read).toHaveBeenCalledTimes(1);
	f.advance(10 * 60_000);
	await f.content.read("one", signal());
	expect(f.read).toHaveBeenCalledTimes(2);
});

test("last content reader cancellation aborts HTTP and does not cache late responses", async () => {
	const f = contentFixture();
	f.add("one");
	let finish!: (value: Uint8Array<ArrayBuffer>) => void;
	let upstreamSignal!: AbortSignal;
	f.read.mockImplementationOnce((_url, signal) => {
		upstreamSignal = signal;
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	const controller = new AbortController();
	const request = f.content.read("one", controller.signal);
	const cancelled = expect(request).rejects.toMatchObject({
		code: "request_cancelled",
	});
	controller.abort();
	await cancelled;
	expect(upstreamSignal.aborted).toBe(true);
	finish(new Uint8Array([9]));
	await f.content.read("one", signal());
	expect(f.read).toHaveBeenCalledTimes(2);
});

test("cached content revalidates opaque references and connection generations", async () => {
	let current = true;
	const readTorrent = vi.fn(async () => ({
		kind: "bytes" as const,
		bytes: new Uint8Array([7]),
	}));
	const connection = {
		current: () => current,
		readTorrent,
	} as unknown as JackettConnection;
	const f = contentFixture(connection);
	f.add("one", "file.torrent", "g");
	await f.content.read("one", signal());
	await f.content.read("one", signal());
	expect(readTorrent).toHaveBeenCalledTimes(1);
	current = false;
	await expect(f.content.read("one", signal())).rejects.toMatchObject({
		code: "source_conflict",
	});
	f.downloads.delete("one");
	await expect(f.content.read("one", signal())).rejects.toMatchObject({
		code: "download_missing",
	});
});

test("torrent cache evicts old entries when its byte budget fills", async () => {
	const f = contentFixture();
	f.read.mockImplementation(async () => new Uint8Array(9 * 1024 * 1024));
	for (let index = 0; index < 4; index++) {
		f.add(String(index), `${index}.torrent`);
		await f.content.read(String(index), signal());
	}
	await f.content.read("1", signal());
	expect(f.read).toHaveBeenCalledTimes(4);
	await f.content.read("0", signal());
	expect(f.read).toHaveBeenCalledTimes(5);
});
