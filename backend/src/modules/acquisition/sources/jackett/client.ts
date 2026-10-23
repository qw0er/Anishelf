import { createHash } from "node:crypto";
import { type SourceEntry, SourceError } from "../domain/model.js";
import type { SourceRequestGate } from "../request-gate.js";
import type {
	JackettCapabilities,
	JackettPlan,
	ReleaseDownload,
	SearchCoverage,
} from "./model.js";
import type { JackettTransport } from "./transport.js";
import { indexerId, titleQueries } from "./validation.js";
import { capabilities, indexers, releases } from "./xml.js";

export class JackettClient {
	private readonly caps = new Map<
		string,
		{ value: JackettCapabilities; expiresAt: number }
	>();
	constructor(
		private readonly transport: JackettTransport,
		private readonly gate: SourceRequestGate,
	) {}
	async indexers(signal: AbortSignal) {
		const xml = await this.gate.run("jackett:indexers", signal, () =>
			this.transport.api(null, { t: "indexers", configured: "true" }, signal),
		);
		return indexers(xml).map((row) => ({
			...row,
			name: this.transport.redact(row.name),
		}));
	}
	async capabilities(id: string, signal: AbortSignal) {
		indexerId(id);
		const saved = this.caps.get(id);
		if (saved && saved.expiresAt > Date.now()) return saved.value;
		const value = await this.gate.run(`jackett:${id}`, signal, async () =>
			capabilities(await this.transport.api(id, { t: "caps" }, signal)),
		);
		this.caps.set(id, { value, expiresAt: Date.now() + 15 * 60_000 });
		return value;
	}
	async search(plan: JackettPlan, signal: AbortSignal) {
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
				const result = await this.gate.run(`jackett:${id}`, signal, async () =>
					releases(
						await this.transport.api(
							id,
							{
								t: "search",
								q: title,
								limit: String(caps.limit),
								offset: String(offset),
							},
							signal,
						),
						{ id, generation: plan.generation },
						(url) => this.transport.download(url, id),
					),
				);
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
					const safe: SourceEntry = {
						...entry,
						title: this.transport.redact(entry.title),
						guid: this.transport.redact(entry.guid ?? ""),
						seedersObservedAt: entry.seeders == null ? null : Date.now(),
					};
					found.set(entry.id, safe);
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
		return this.transport.close();
	}
}
