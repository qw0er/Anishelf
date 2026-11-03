import {
	type AiringEpisode,
	type CachedMetadata,
	MetadataError,
	type Page,
	type ReadOptions,
	type WorkDetails,
	type WorkReference,
	type WorkRelation,
} from "../domain/model.js";
import { projectDetails, projectSummary } from "../domain/projection.js";
import type * as Source from "../domain/source-model.js";
import type { SourceMetadataApi } from "../ports.js";
import type { MetadataIdentities } from "./identities.js";
import { readMetadata } from "./operations.js";
import { combineResults, projectEnvelope, projectPage } from "./results.js";
import type { MetadataSnapshots } from "./snapshots.js";

export class MetadataWorkReader {
	constructor(
		private readonly source: Pick<
			SourceMetadataApi,
			"get" | "current" | "providers" | "relations" | "airing"
		>,
		private readonly identities: Pick<
			MetadataIdentities,
			"references" | "referenceForExternal"
		>,
		private readonly snapshots: Pick<MetadataSnapshots, "save">,
	) {}
	private sourceReference(reference: WorkReference) {
		const [source] = this.identities.references(reference);
		if (!source)
			throw new MetadataError({
				code: "not-found",
				message: "Work not found.",
				retryAt: null,
			});
		return source;
	}

	private project(
		value: CachedMetadata<Source.WorkDetails>,
	): CachedMetadata<WorkDetails> {
		return this.snapshots.save(
			"detail",
			projectEnvelope(value, (work) =>
				projectDetails(
					work,
					this.identities.referenceForExternal(work.reference),
				),
			),
			{ cover: value.data, banner: value.data },
		);
	}
	async get(
		reference: WorkReference,
		options: ReadOptions = {},
	): Promise<CachedMetadata<WorkDetails>> {
		const value = await readMetadata(() =>
			this.source.get(this.sourceReference(reference), options),
		);
		return this.project(value);
	}
	current(reference: WorkReference): CachedMetadata<WorkDetails> | null {
		const value = this.source.current(this.sourceReference(reference));
		return value ? this.project(value) : null;
	}

	private relatedReference(
		kind: "relations" | "airing",
		reference: WorkReference,
		page: number,
		perPage: number,
	) {
		if (
			!Number.isSafeInteger(page) ||
			page < 1 ||
			!Number.isSafeInteger(perPage) ||
			perPage < 1 ||
			perPage > 25
		)
			throw new MetadataError({
				code: "invalid-request",
				message: "Invalid metadata pagination.",
				retryAt: null,
			});
		const capabilities = this.source.providers();
		return this.identities
			.references(reference)
			.find((ref) =>
				capabilities.some(
					(provider) => provider.key === ref.provider && provider[kind],
				),
			);
	}
	relations(
		reference: WorkReference,
		page = 1,
		perPage = 25,
		options: ReadOptions = {},
	): Promise<CachedMetadata<Page<WorkRelation>>> {
		return readMetadata(async () => {
			const ref = this.relatedReference("relations", reference, page, perPage);
			if (!ref)
				return this.snapshots.save(
					"relations",
					combineResults([], {
						unavailable: true,
						items: [] as WorkRelation[],
						page,
						perPage,
						hasNextPage: false,
					}),
				);
			const result = await this.source.relations(ref, page, perPage, options);
			return this.snapshots.save(
				"relations",
				projectEnvelope(result, (data) =>
					projectPage(data, (item) => ({
						type: item.type,
						work: projectSummary(
							item.work,
							this.identities.referenceForExternal(item.work.reference),
						),
					})),
				),
			);
		});
	}
	airing(
		reference: WorkReference,
		page = 1,
		perPage = 25,
		options: ReadOptions = {},
	): Promise<CachedMetadata<Page<AiringEpisode>>> {
		return readMetadata(async () => {
			const ref = this.relatedReference("airing", reference, page, perPage);
			if (!ref)
				return this.snapshots.save(
					"airing",
					combineResults([], {
						unavailable: true,
						items: [] as AiringEpisode[],
						page,
						perPage,
						hasNextPage: false,
					}),
				);
			const result = await this.source.airing(ref, page, perPage, options);
			return this.snapshots.save(
				"airing",
				projectEnvelope(result, (data) =>
					projectPage(data, (item) => ({ ...item, id: String(item.episode) })),
				),
			);
		});
	}
}
