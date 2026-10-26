import type { Logger } from "pino";
import { workKey } from "../../../../shared/external-reference.js";
import {
	MetadataError,
	type MetadataSnapshot,
	type ProviderReference,
	type ReadOptions,
	type SearchRequest,
	type WorkDetails,
} from "../domain/source-model.js";
import { detailFreshnessMs, metadataPolicy as policy } from "../policy.js";
import type {
	MetadataArtwork,
	MetadataProvider,
	MetadataStore,
	SourceMetadataApi,
} from "../ports.js";
import { MetadataCacheReader } from "./cache-reader.js";

/** Owns provider-facing use cases; the cache reader owns refresh and snapshot lifecycle. */
export class SourceMetadataApplication implements SourceMetadataApi {
	private readonly cache: MetadataCacheReader;
	private readonly providerMap: Map<string, MetadataProvider>;
	constructor(
		private readonly options: {
			providers: MetadataProvider[];
			defaultProvider: string;
			store: MetadataStore;
			artwork: MetadataArtwork;
			logger: Logger;
			now?: () => number;
		},
	) {
		this.cache = new MetadataCacheReader(options);
		this.providerMap = new Map(
			options.providers.map((provider) => [
				provider.capabilities.key,
				provider,
			]),
		);
		if (this.providerMap.size !== options.providers.length)
			throw new Error("Duplicate metadata provider key.");
		if (!this.providerMap.has(options.defaultProvider))
			throw new Error("Unknown default metadata provider.");
	}
	resolveReference(value: string, provider?: string): ProviderReference {
		const input = value.trim();
		if (!input || input.length > 2000)
			throw this.invalid("Enter an ID or supported work URL.");
		const preferred = this.provider({
			provider: provider ?? this.options.defaultProvider,
			mediaType: "anime",
			id: "lookup",
		});
		const candidates = provider
			? [preferred]
			: [
					preferred,
					...[...this.providerMap.values()].filter(
						(adapter) => adapter !== preferred,
					),
				];
		for (const adapter of candidates) {
			const reference = adapter.resolveReference
				? adapter.resolveReference(input)
				: {
						provider: adapter.capabilities.key,
						mediaType: "anime" as const,
						id: input,
					};
			if (!reference || reference.provider !== adapter.capabilities.key)
				continue;
			this.provider(reference);
			this.options.logger.debug(
				{ event: "metadata.reference_resolved", provider: reference.provider },
				"Metadata source reference resolved.",
			);
			return reference;
		}
		throw this.invalid("Enter a valid ID or supported work URL.");
	}

	providers() {
		return [...this.providerMap.values()].map((provider) => ({
			...provider.capabilities,
		}));
	}
	private provider(reference: ProviderReference): MetadataProvider {
		if (
			reference.mediaType !== "anime" ||
			!reference.id ||
			reference.id.length > 200
		)
			throw this.invalid("Supply a qualified anime reference.");
		const provider = this.providerMap.get(reference.provider);
		if (!provider) throw this.invalid("Unknown metadata provider.");
		return provider;
	}
	private invalid(message: string) {
		return new MetadataError({
			code: "invalid-request",
			message,
			retryAt: null,
		});
	}
	private page(page: number, perPage: number, max = 50): void {
		if (
			!Number.isSafeInteger(page) ||
			page < 1 ||
			page > 10000 ||
			!Number.isSafeInteger(perPage) ||
			perPage < 1 ||
			perPage > max
		)
			throw this.invalid("Invalid metadata pagination.");
	}
	search(request: SearchRequest, options: ReadOptions = {}) {
		const query = request.query.normalize("NFKC").trim().replace(/\s+/gu, " ");
		if (
			!query ||
			query.length > 200 ||
			[...query].some((character) => character.charCodeAt(0) < 32)
		)
			throw this.invalid("Search requires a title of 1–200 characters.");
		const provider = this.provider({
			provider: request.provider ?? this.options.defaultProvider,
			mediaType: "anime",
			id: "search",
		});
		const page = request.page ?? 1,
			perPage = request.perPage ?? 10;
		this.page(page, perPage);
		return this.cache.read(
			provider,
			"search",
			{ query, page, perPage },
			options,
			(signal) => provider.search(query, page, perPage, signal),
			(data) =>
				data.items.length ? policy.searchFreshMs : policy.emptySearchFreshMs,
		);
	}
	get(reference: ProviderReference, options: ReadOptions = {}) {
		reference = {
			provider: reference.provider,
			mediaType: reference.mediaType,
			id: reference.id,
		};
		const provider = this.provider(reference);
		return this.cache.read(
			provider,
			"detail",
			reference,
			options,
			(signal) => provider.get(reference, signal),
			(data) => detailFreshnessMs(data.status),
		);
	}
	relations(
		reference: ProviderReference,
		page = 1,
		perPage = 25,
		options: ReadOptions = {},
	) {
		reference = {
			provider: reference.provider,
			mediaType: reference.mediaType,
			id: reference.id,
		};
		this.page(page, perPage, 25);
		const provider = this.provider(reference);
		if (!provider.capabilities.relations)
			throw this.invalid("Provider does not supply relations.");
		return this.cache.read(
			provider,
			"relations",
			{ reference, page, perPage },
			options,
			(signal) => provider.relations(reference, page, perPage, signal),
			() => policy.detailFreshMs,
		);
	}
	airing(
		reference: ProviderReference,
		page = 1,
		perPage = 25,
		options: ReadOptions = {},
	) {
		reference = {
			provider: reference.provider,
			mediaType: reference.mediaType,
			id: reference.id,
		};
		this.page(page, perPage, 25);
		const provider = this.provider(reference);
		if (!provider.capabilities.airing)
			throw this.invalid("Provider does not supply airing schedules.");
		return this.cache.read(
			provider,
			"airing",
			{ reference, page, perPage },
			options,
			(signal) => provider.airing(reference, page, perPage, signal),
			() => policy.airingFreshMs,
		);
	}
	current(reference: ProviderReference) {
		const entry = this.options.store.current(workKey(reference));
		if (!entry) return null;
		const snapshot = this.cache.snapshot(entry.id);
		if (snapshot.kind !== "detail")
			throw new Error("Current work information requires a detail snapshot.");
		const { kind: _, ...value } = snapshot;
		return value;
	}
	snapshot(id: string): MetadataSnapshot {
		return this.cache.snapshot(id);
	}
	retain(id: string, ownerId: string): void {
		this.cache.retain(id, ownerId);
	}
	release(id: string, ownerId: string): void {
		this.cache.release(id, ownerId);
	}

	async artwork(
		reference: ProviderReference,
		kind: "cover" | "banner",
		options: ReadOptions = {},
	) {
		if (kind !== "cover" && kind !== "banner")
			throw this.invalid("Unknown artwork kind.");
		const details = await this.get(reference, options);
		const data: WorkDetails = details.data;
		return this.options.artwork.get(
			JSON.stringify([reference.provider, reference.id, kind]),
			kind === "cover" ? data.coverUrl : data.bannerUrl,
			options,
		);
	}
	snapshotArtwork(snapshotId: string, kind: "cover" | "banner") {
		if (kind !== "cover" && kind !== "banner")
			throw this.invalid("Unknown artwork kind.");
		const snapshot = this.snapshot(snapshotId);
		if (snapshot.kind !== "detail")
			throw this.invalid("Artwork requires a detail snapshot.");
		const { reference, coverUrl, bannerUrl } = snapshot.data;
		return this.options.artwork.get(
			JSON.stringify([reference.provider, reference.id, kind]),
			kind === "cover" ? coverUrl : bannerUrl,
			{},
		);
	}
	artworkEvidence(
		data: WorkDetails,
		kind: "cover" | "banner",
		options: ReadOptions = {},
	) {
		return this.options.artwork.get(
			JSON.stringify([data.reference.provider, data.reference.id, kind]),
			kind === "cover" ? data.coverUrl : data.bannerUrl,
			options,
		);
	}
	readArtwork(id: string) {
		return this.options.artwork.read(id);
	}
	cachedArtworkId(reference: ProviderReference, kind: "cover" | "banner") {
		if (kind !== "cover" && kind !== "banner")
			throw this.invalid("Unknown artwork kind.");
		return this.options.artwork.cached(
			JSON.stringify([reference.provider, reference.id, kind]),
		);
	}
	async close(): Promise<void> {
		await this.cache.close();
		await this.options.artwork.close();
	}
}
