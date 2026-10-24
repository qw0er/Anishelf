import { createHash } from "node:crypto";
import type { Logger } from "pino";
import type { SourceQuery } from "../domain/binding.js";
import type { ReleaseDownload } from "../domain/download.js";
import { type SourceEntry, SourceError } from "../domain/model.js";
import type { SourceRequestGate } from "../infrastructure/request-gate.js";
import type { JackettCapabilities, SearchCoverage } from "./model.js";
import { JackettQueryCache } from "./query-cache.js";
import type { JackettTransport } from "./transport.js";
import { indexerId, titleQueries } from "./validation.js";
import { capabilities, indexers, releases } from "./xml.js";

export class JackettClient {
	private readonly caps: JackettQueryCache<JackettCapabilities>;
	private readonly pages: JackettQueryCache<ReturnType<typeof releases>>;
	private readonly now: () => number;
	constructor(
		private readonly transport: JackettTransport,
		private readonly gate: SourceRequestGate,
		private readonly options: { now?: () => number; logger?: Logger } = {},
	) {
		this.now = options.now ?? Date.now;
		this.caps = new JackettQueryCache(128, 128, this.now);
		this.pages = new JackettQueryCache(128, 10 * 1024 * 1024, this.now);
	}
	async indexers(signal: AbortSignal) {
		const rows = await this.response(
			null,
			{ t: "indexers", configured: "true" },
			signal,
			indexers,
		);
		return rows.map((row) => ({
			...row,
			name: this.transport.redact(row.name),
		}));
	}
	async capabilities(id: string, signal: AbortSignal) {
		indexerId(id);
		const result = await this.caps.read(id, signal, async (shared) => ({
			value: await this.response(id, { t: "caps" }, shared, capabilities),
			ttlMs: 15 * 60_000,
			weight: 1,
		}));
		this.cacheLog(id, "capabilities", result.cache);
		return { ...result.value };
	}
	private async response<T>(
		id: string | null,
		parameters: Record<string, string>,
		signal: AbortSignal,
		parse: (xml: string) => T,
	): Promise<T> {
		const keys = this.transport.requestKeys(id);
		const operation = async () =>
			parse(await this.transport.api(id, parameters, signal));
		try {
			return this.transport.requestGate
				? await operation()
				: await this.gate.runMany(keys, signal, operation);
		} catch (error) {
			// Torznab can report a rate limit inside an HTTP 200 XML response.
			if (error instanceof SourceError && error.code === "rate_limited") {
				const gate = this.transport.requestGate ?? this.gate;
				for (const key of keys)
					gate.cooldown(key, error.retryAt ?? this.now() + 60_000);
			}
			throw error;
		}
	}
	private cacheLog(
		id: string,
		operation: string,
		cache: "hit" | "shared" | "miss",
	) {
		this.options.logger?.debug(
			{
				event: "acquisition.jackett_query_cache",
				indexerId: id,
				generation: this.transport.generation,
				operation,
				cache,
			},
			"Jackett request cache checked.",
		);
	}
	private async page(
		id: string,
		title: string,
		limit: number,
		offset: number,
		signal: AbortSignal,
	) {
		const key = JSON.stringify([
			this.transport.generation,
			id,
			title.toLowerCase(),
			limit,
			offset,
		]);
		const result = await this.pages.read(key, signal, async (shared) => {
			let weight = 0;
			const parsed = await this.response(
				id,
				{ t: "search", q: title, limit: String(limit), offset: String(offset) },
				shared,
				(xml) => {
					weight = Buffer.byteLength(xml);
					return releases(
						xml,
						{ id, generation: this.transport.generation },
						(url) => this.transport.download(url, id),
					);
				},
			);
			const observedAt = this.now();
			return {
				value: {
					...parsed,
					entries: parsed.entries.map((entry) => ({
						...entry,
						title: this.transport.redact(entry.title),
						guid: this.transport.redact(entry.guid ?? ""),
						seedersObservedAt: entry.seeders == null ? null : observedAt,
					})),
				},
				ttlMs: parsed.count ? 10 * 60_000 : 5 * 60_000,
				weight,
			};
		});
		this.cacheLog(id, "search_page", result.cache);
		return result.value;
	}
	async search(
		plan: SourceQuery,
		signal: AbortSignal,
		accept?: (entries: readonly SourceEntry[]) => boolean,
	) {
		if (plan.generation !== this.transport.generation)
			throw new SourceError("source_conflict");
		const titles = titleQueries(plan.titles),
			id = indexerId(plan.indexerId);
		const caps = await this.capabilities(id, signal);
		if (!caps.search) throw new SourceError("unsupported_capability");
		const coverage: SearchCoverage = {
			limited: false,
			reason: null,
			pages: 0,
			queries: 0,
		};
		const found = new Map<string, SourceEntry>();
		let itemCount = 0;
		outer: for (const title of titles) {
			coverage.queries++;
			let offset = 0;
			const seen = new Set<string>();
			for (let page = 0; page < 3; page++) {
				const result = await this.page(id, title, caps.limit, offset, signal);
				coverage.pages++;
				const fingerprint = createHash("sha256")
					.update(
						result.entries
							.map((entry) => entry.id)
							.sort()
							.join("\n"),
					)
					.digest("hex");
				if (seen.has(fingerprint) && result.count > 0) {
					coverage.limited = true;
					coverage.reason = "repeated_page";
					break;
				}
				seen.add(fingerprint);
				for (const entry of result.entries) {
					if (++itemCount > 1000) {
						coverage.limited = true;
						coverage.reason = "item_limit";
						break outer;
					}
					found.set(entry.id, {
						...entry,
						download: entry.download ? { ...entry.download } : null,
					});
				}
				if (accept?.([...found.values()])) {
					coverage.limited = true;
					coverage.reason = "accepted";
					break outer;
				}
				if (!result.count) break;
				if (result.offset !== null && result.offset !== offset) {
					coverage.limited = true;
					coverage.reason = "repeated_page";
					break;
				}
				offset += result.count;
				if (result.total !== null && offset >= result.total) break;
				if (result.total === null) {
					coverage.limited = true;
					coverage.reason = "missing_pagination";
					break;
				}
				if (page === 2) {
					coverage.limited = true;
					coverage.reason = "page_limit";
				}
			}
		}
		return {
			entries: [...found.values()],
			coverage,
			outcome: found.size ? ("matches" as const) : ("no_match" as const),
		};
	}
	readTorrent(descriptor: ReleaseDownload, signal: AbortSignal) {
		return this.transport.readTorrent(descriptor, signal);
	}
	close() {
		this.caps.close();
		this.pages.close();
		return this.transport.close();
	}
}
