import type { Logger } from "pino";
import { workKey } from "../../../../../shared/external-reference.js";
import type { CachedMetadata, ReadOptions } from "../domain/model.js";
import type { WorkDetails, WorkSummary } from "../domain/source-model.js";
import type { SourceMetadataApi } from "../ports.js";

const native = (work: WorkSummary) =>
	work.titles
		.find((title) => title.kind === "native")
		?.value.normalize("NFKC")
		.trim()
		.replace(/\s+/gu, " ") ?? "";
function signature(work: WorkDetails): string | null {
	const date = work.startDate;
	if (
		!native(work) ||
		!work.format ||
		!Number.isSafeInteger(work.episodeCount) ||
		(work.episodeCount ?? 0) < 1 ||
		!date?.year ||
		!date.month ||
		!date.day
	)
		return null;
	const actual = new Date(Date.UTC(date.year, date.month - 1, date.day));
	if (
		actual.getUTCFullYear() !== date.year ||
		actual.getUTCMonth() + 1 !== date.month ||
		actual.getUTCDate() !== date.day
	)
		return null;
	return JSON.stringify([
		native(work),
		date.year,
		date.month,
		date.day,
		work.format,
		work.episodeCount,
	]);
}
const fresh = (value: CachedMetadata<unknown>) =>
	!value.stale && !value.refreshing && !value.refreshError;
interface Evidence {
	signature: string;
	peer: WorkDetails["reference"];
	expiresAt: number;
}
/** Names-only evidence. Never associates identities, fields, episodes or Tracking targets. */
export class MetadataNameEnrichment {
	private readonly evidence = new Map<string, Evidence>();
	private readonly pending = new Map<string, Promise<void>>();
	constructor(
		private readonly source: Pick<
			SourceMetadataApi,
			"get" | "current" | "search" | "providers"
		>,
		private readonly logger?: Logger,
	) {}
	cached<T extends WorkSummary>(value: CachedMetadata<T>): CachedMetadata<T> {
		const entry = this.evidence.get(workKey(value.data.reference));
		if (!entry || entry.expiresAt <= Date.now() || !fresh(value)) return value;
		const own = this.source.current(value.data.reference),
			peer = this.source.current(entry.peer);
		if (
			!own ||
			!peer ||
			!fresh(own) ||
			!fresh(peer) ||
			signature(own.data) !== entry.signature ||
			signature(peer.data) !== entry.signature ||
			native(value.data) !== native(own.data) ||
			value.data.format !== own.data.format ||
			value.data.episodeCount !== own.data.episodeCount
		)
			return value;
		const seen = new Set(value.data.titles.map((title) => title.value));
		const titles = [...value.data.titles];
		for (const title of peer.data.titles)
			if (!seen.has(title.value)) {
				seen.add(title.value);
				titles.push({ ...title, kind: "alias" });
			}
		return { ...value, data: { ...value.data, titles } };
	}
	async enrich<T extends WorkSummary>(
		value: CachedMetadata<T>,
		options: ReadOptions = {},
	): Promise<CachedMetadata<T>> {
		const providers = this.source.providers();
		if (providers.length !== 2 || !native(value.data) || !fresh(value))
			return value;
		const cached = this.cached(value);
		if (cached !== value || options.cachedOnly) return cached;
		const key = workKey(value.data.reference);
		let task = this.pending.get(key);
		if (!task) {
			const signal = AbortSignal.any([
				AbortSignal.timeout(5000),
				...(options.signal ? [options.signal] : []),
			]);
			task = this.verify(value.data, { signal })
				.catch((error) => {
					this.logger?.debug(
						{
							event: "metadata.name_enrichment_skipped",
							provider: value.data.reference.provider,
							reason: signal.aborted
								? "cancelled-or-timeout"
								: "source-failure",
							err: error,
						},
						"Optional name verification did not complete.",
					);
				})
				.finally(() => this.pending.delete(key));
			this.pending.set(key, task);
		}
		await task;
		options.signal?.throwIfAborted();
		return this.cached(value);
	}
	private async candidates(
		provider: string,
		origin: WorkDetails,
		options: ReadOptions,
	): Promise<WorkDetails[] | null> {
		const results = await this.source.search(
			{ provider, query: native(origin), page: 1, perPage: 50 },
			options,
		);
		if (!fresh(results) || results.data.hasNextPage) return null;
		const unique = new Map(
			results.data.items
				.filter(
					(work) =>
						native(work) === native(origin) &&
						work.format === origin.format &&
						work.episodeCount === origin.episodeCount,
				)
				.map((work) => [workKey(work.reference), work]),
		);
		if (unique.size > 5) return null;
		const details = await Promise.all(
			[...unique.values()].map((work) =>
				this.source.get(work.reference, options),
			),
		);
		// An unreadable/incomplete candidate cannot be ruled out as another match.
		if (details.some((detail) => !fresh(detail) || !signature(detail.data)))
			return null;
		return details
			.filter((detail) => signature(detail.data) === signature(origin))
			.map((detail) => detail.data);
	}
	private async verify(work: WorkSummary, options: ReadOptions): Promise<void> {
		const origin = await this.source.get(work.reference, options);
		const basis = signature(origin.data);
		if (
			!fresh(origin) ||
			!basis ||
			native(work) !== native(origin.data) ||
			work.format !== origin.data.format ||
			work.episodeCount !== origin.data.episodeCount
		)
			return;
		const providers = this.source.providers();
		const matches = await Promise.all(
			providers.map((provider) =>
				this.candidates(provider.key, origin.data, options),
			),
		);
		const ownIndex = providers.findIndex(
			(provider) => provider.key === work.reference.provider,
		);
		const own = matches[ownIndex],
			peer = matches[ownIndex === 0 ? 1 : 0];
		if (
			!own?.[0] ||
			own.length !== 1 ||
			peer?.length !== 1 ||
			workKey(own[0].reference) !== workKey(work.reference)
		) {
			this.logger?.debug(
				{
					event: "metadata.name_enrichment_rejected",
					provider: work.reference.provider,
					candidateCounts: matches.map((items) => items?.length ?? null),
				},
				"Name evidence is incomplete or not unique in both sources.",
			);
			return;
		}
		const other = peer[0];
		if (!other) return;
		if (this.evidence.size >= 500) this.evidence.clear();
		this.evidence.set(workKey(work.reference), {
			signature: basis,
			peer: other.reference,
			expiresAt: Date.now() + 10 * 60_000,
		});
		this.evidence.set(workKey(other.reference), {
			signature: basis,
			peer: work.reference,
			expiresAt: Date.now() + 10 * 60_000,
		});
		this.logger?.debug(
			{
				event: "metadata.names_verified",
				provider: work.reference.provider,
				peerProvider: other.reference.provider,
			},
			"Unique names-only correspondence verified using exact native title, full date, format and episode count.",
		);
	}
}
