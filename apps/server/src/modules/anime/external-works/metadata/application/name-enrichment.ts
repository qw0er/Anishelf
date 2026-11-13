import { workKey } from "@anishelf/contracts/references";
import type { Logger } from "pino";
import { metadataDefaults } from "../defaults.js";
import { abortable } from "../domain/async.js";
import {
	type CachedMetadata,
	MetadataError,
	type ReadOptions,
} from "../domain/model.js";
import {
	nameCorrespondence,
	nameFingerprint,
	relatedNames,
} from "../domain/name-correspondence.js";
import type { NameEvidence } from "../domain/project-document.js";
import type { WorkDetails, WorkSummary } from "../domain/source-model.js";
import type { SourceMetadataApi } from "../ports.js";

const normalizeName = (value: string) =>
	value.normalize("NFKC").trim().replace(/\s+/gu, " ");
const native = (work: WorkSummary) =>
	normalizeName(
		work.titles.find((title) => title.kind === "native")?.value ?? "",
	);
/** Only source-declared primary title roles can establish correspondence. */
function explicitNames(work: WorkSummary): string[] {
	return [
		...new Set(
			work.titles
				.filter(
					(title) =>
						title.kind === "native" ||
						title.kind === "english" ||
						title.kind === "romaji",
				)
				.map((title) => normalizeName(title.value))
				.filter(Boolean),
		),
	];
}
const fresh = (value: CachedMetadata<unknown>) =>
	!value.stale && !value.refreshing && !value.refreshError;
interface Evidence {
	ownSignature: string;
	peerSignature: string;
	peer: WorkDetails["reference"];
	expiresAt: number;
}
export interface NameVerificationOptions {
	timeoutMs?: number;
	throwOnFailure?: boolean;
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
			nameFingerprint(own.data) !== entry.ownSignature ||
			nameFingerprint(peer.data) !== entry.peerSignature ||
			native(value.data) !== native(own.data) ||
			value.data.format !== own.data.format ||
			value.data.episodeCount !== own.data.episodeCount
		)
			return value;
		const titles = [...value.data.titles];
		for (const title of peer.data.titles) {
			const index = titles.findIndex(
				(existing) => existing.value === title.value,
			);
			const searchKind =
				title.kind === "romaji" || title.kind === "english"
					? title.kind
					: undefined;
			const existing = titles[index];
			if (!existing)
				titles.push({
					...title,
					kind: "alias",
					...(searchKind ? { searchKind } : {}),
				});
			else if (existing.kind === "alias" && !existing.searchKind && searchKind)
				titles[index] = { ...existing, searchKind };
		}

		return { ...value, data: { ...value.data, titles } };
	}
	/** Persist only a currently valid names-only proof, never just a copied alias list. */
	proof(value: CachedMetadata<WorkDetails>): NameEvidence | undefined {
		if (this.cached(value) === value) return undefined;
		const entry = this.evidence.get(workKey(value.data.reference));
		if (!entry) return undefined;
		const own = this.source.current(value.data.reference),
			peer = this.source.current(entry.peer);
		if (!own || !peer) return undefined;
		return {
			verificationVersion: metadataDefaults.nameVerificationVersion,
			originSnapshotId: own.snapshotId,
			peerSnapshotId: peer.snapshotId,
			peer: entry.peer,
		};
	}
	async enrich<T extends WorkSummary>(
		value: CachedMetadata<T>,
		options: ReadOptions = {},
		verification: NameVerificationOptions = {},
	): Promise<CachedMetadata<T>> {
		const providers = this.source.providers();
		if (
			providers.length !== 2 ||
			!explicitNames(value.data).length ||
			!fresh(value)
		)
			return value;
		const cached = this.cached(value);
		if (cached !== value || options.cachedOnly) return cached;
		options.signal?.throwIfAborted();
		const key = workKey(value.data.reference);
		let task = this.pending.get(key);
		if (!task) {
			// A foreground subscriber must not shorten or cancel a shared background verification.
			task = this.verify(value.data, {
				signal: AbortSignal.timeout(metadataDefaults.nameVerificationTimeoutMs),
			}).finally(() => this.pending.delete(key));
			this.pending.set(key, task);
		}
		const signal = AbortSignal.any([
			AbortSignal.timeout(verification.timeoutMs ?? 5000),
			...(options.signal ? [options.signal] : []),
		]);
		try {
			await abortable(task, signal);
		} catch (error) {
			this.logger?.debug(
				{
					event: "metadata.name_enrichment_skipped",
					provider: value.data.reference.provider,
					reason: signal.aborted ? "cancelled-or-timeout" : "source-failure",
					err: error,
				},
				"Optional name verification did not complete.",
			);
			options.signal?.throwIfAborted();
			if (verification.throwOnFailure) throw error;
		}
		options.signal?.throwIfAborted();
		return this.cached(value);
	}
	private async candidates(
		provider: string,
		origin: WorkDetails,
		options: ReadOptions,
		read: Pick<SourceMetadataApi, "search" | "get">,
	): Promise<WorkDetails[] | null> {
		const results = await Promise.all(
			explicitNames(origin).map(async (query) => {
				const request = { provider, query, page: 1, perPage: 50 };
				const value = await read.search(request, options);
				return !fresh(value) && !value.refreshError && !options.cachedOnly
					? read.search(request, { ...options, refresh: true })
					: value;
			}),
		);
		const searchFailure = results.find(
			(result) => result.refreshError,
		)?.refreshError;
		if (searchFailure) throw new MetadataError(searchFailure);
		// A partial search cannot establish that the correspondence is unique.
		if (results.some((result) => !fresh(result) || result.data.hasNextPage))
			return null;
		const unique = new Map(
			results
				.flatMap((result) => result.data.items)
				.filter((work) => relatedNames(work, origin))
				.map((work) => [workKey(work.reference), work]),
		);
		if (unique.size > 5) return null;
		const details = await Promise.all(
			[...unique.values()].map(async (work) => {
				const value = await read.get(work.reference, options);
				return !fresh(value) && !value.refreshError && !options.cachedOnly
					? read.get(work.reference, { ...options, refresh: true })
					: value;
			}),
		);
		const detailFailure = details.find(
			(detail) => detail.refreshError,
		)?.refreshError;
		if (detailFailure) throw new MetadataError(detailFailure);
		// An unreadable/incomplete candidate cannot be ruled out as another match.
		if (details.some((detail) => !fresh(detail))) return null;
		const decisions = details.map((detail) => ({
			detail,
			decision: nameCorrespondence(origin, detail.data),
		}));
		for (const { detail, decision } of decisions)
			this.logger?.debug(
				{
					event: "metadata.name_candidate_assessed",
					originId: origin.reference.id,
					provider,
					providerId: detail.data.reference.id,
					...decision,
				},
				"Names-only candidate evidence assessed.",
			);
		// Insufficient evidence is still a plausible competitor, not evidence of uniqueness.
		if (decisions.some(({ decision }) => decision.state === "insufficient"))
			return null;
		return decisions
			.filter(({ decision }) => decision.state === "confirmed")
			.map(({ detail }) => detail.data);
	}
	private async verify(work: WorkSummary, options: ReadOptions): Promise<void> {
		const origin = await this.source.get(work.reference, options);
		if (origin.refreshError) throw new MetadataError(origin.refreshError);
		const basis = nameFingerprint(origin.data);
		if (
			!fresh(origin) ||
			!basis ||
			native(work) !== native(origin.data) ||
			work.format !== origin.data.format ||
			work.episodeCount !== origin.data.episodeCount
		) {
			this.logger?.debug(
				{
					event: "metadata.name_enrichment_rejected",
					provider: work.reference.provider,
					reason: "origin-evidence-incomplete-or-changed",
				},
				"Name verification requires current source identity evidence.",
			);
			return;
		}
		const searches = new Map<string, ReturnType<SourceMetadataApi["search"]>>();
		const details = new Map<string, ReturnType<SourceMetadataApi["get"]>>([
			[`${workKey(work.reference)}:false`, Promise.resolve(origin)],
		]);
		const read: Pick<SourceMetadataApi, "search" | "get"> = {
			search: (request, readOptions) => {
				const key = JSON.stringify([request, readOptions?.refresh === true]);
				let value = searches.get(key);
				if (!value) {
					value = this.source.search(request, readOptions);
					searches.set(key, value);
				}
				return value;
			},
			get: (reference, readOptions) => {
				const key = `${workKey(reference)}:${readOptions?.refresh === true}`;
				let value = details.get(key);
				if (!value) {
					value = this.source.get(reference, readOptions);
					details.set(key, value);
				}
				return value;
			},
		};
		const providers = this.source.providers();
		const matches = await Promise.all(
			providers.map((provider) =>
				this.candidates(provider.key, origin.data, options, read),
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
					reason: "candidate-evidence-incomplete-or-ambiguous",
					state: matches.some((items) => items && items.length > 1)
						? "ambiguous"
						: "insufficient",
					candidateCounts: matches.map((items) => items?.length ?? null),
				},
				"Name evidence is incomplete or not unique in both sources.",
			);
			return;
		}
		const other = peer[0];
		if (!other) return;
		// The peer may declare another primary spelling; it must uniquely resolve back too.
		const reverse = await Promise.all(
			providers.map((provider) =>
				this.candidates(provider.key, other, options, read),
			),
		);
		const reverseOwn = reverse[ownIndex],
			reversePeer = reverse[ownIndex === 0 ? 1 : 0];
		const reverseOrigin = reverseOwn?.[0],
			reverseOther = reversePeer?.[0];
		if (
			!reverseOrigin ||
			!reverseOther ||
			reverseOwn?.length !== 1 ||
			reversePeer?.length !== 1 ||
			workKey(reverseOrigin.reference) !== workKey(work.reference) ||
			workKey(reverseOther.reference) !== workKey(other.reference)
		) {
			this.logger?.debug(
				{
					event: "metadata.name_enrichment_rejected",
					provider: work.reference.provider,
					reason: "reverse-evidence-incomplete-or-ambiguous",
					state: reverse.some((items) => items && items.length > 1)
						? "ambiguous"
						: "insufficient",
					candidateCounts: reverse.map((items) => items?.length ?? null),
				},
				"Name evidence must uniquely resolve back to the originating work.",
			);
			return;
		}

		const otherBasis = nameFingerprint(other);
		if (!otherBasis) return;
		if (this.evidence.size >= 500) this.evidence.clear();
		this.evidence.set(workKey(work.reference), {
			ownSignature: basis,
			peerSignature: otherBasis,
			peer: other.reference,
			expiresAt: Date.now() + 10 * 60_000,
		});
		this.evidence.set(workKey(other.reference), {
			ownSignature: otherBasis,
			peerSignature: basis,
			peer: work.reference,
			expiresAt: Date.now() + 10 * 60_000,
		});
		this.logger?.debug(
			{
				event: "metadata.names_verified",
				provider: work.reference.provider,
				peerProvider: other.reference.provider,
				matchedTitleCount: explicitNames(origin.data).filter((name) =>
					explicitNames(other).includes(name),
				).length,
			},
			"Unique names-only correspondence verified with corroborated titles and release-scope safeguards.",
		);
	}
}
