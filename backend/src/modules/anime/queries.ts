import type { Logger } from "pino";
import { DomainError } from "../../shared/errors.js";
import { workKey, workReference } from "../../shared/external-reference.js";
import type { CatalogMetadata as MetadataApi } from "./anime-catalog/ports.js";
import type { AnimeCatalogApi } from "./anime-catalog/public.js";
import type { MetadataAssociations } from "./metadata/public.js";
import { MetadataError, workTitle } from "./metadata/public.js";

import type { AnimeApi, AnimeDetail } from "./public.js";
import type { TrackingApi } from "./tracking/public.js";

/** Anime-only reads; cross-module acquisition composition belongs to app. */
type Queries = AnimeApi["queries"];
export class AnimeQueries implements Queries {
	constructor(
		private readonly catalog:
			| Pick<AnimeCatalogApi, "getLocalWorkDetail" | "findLocalWork">
			| undefined,
		private readonly metadata: Pick<MetadataApi, "get"> | undefined,
		private readonly tracking: Pick<TrackingApi, "list" | "status">,
		private readonly logger: Logger,
		private readonly associations?: MetadataAssociations,
	) {}
	async detail(
		input: { localWorkId: string } | { key: string },
	): Promise<AnimeDetail> {
		const tracking = this.tracking.list();
		const localId =
			"localWorkId" in input
				? input.localWorkId
				: await this.findLocal(input.key);
		const local =
			localId && this.catalog
				? await this.catalog.getLocalWorkDetail(localId)
				: null;
		if ("localWorkId" in input && !local)
			throw new DomainError(
				"CATALOG_UNAVAILABLE",
				"Local Catalog is unavailable.",
			);
		const reference = local
			? (this.associations?.externalReference(
					local.work.reference,
					tracking.provider.key,
				) ?? this.associations?.externalReference(local.work.reference))
			: this.reference("key" in input ? input.key : "");
		if (!reference)
			throw new DomainError(
				"INVALID_REQUEST",
				"Work association was not found.",
			);
		const key = workKey(reference);
		let metadata = local?.metadata ?? null;
		let metadataError: AnimeDetail["metadataError"] =
			!local && !this.metadata
				? {
						code: "unavailable",
						message: "Work information is unavailable.",
						retryAt: null,
					}
				: null;
		if (!local && this.metadata) {
			try {
				metadata = await this.metadata.get(this.projectReference(reference));
			} catch (error) {
				if (!(error instanceof MetadataError)) throw error;
				metadataError = error.failure;
			}
		}
		if (this.tracking.status().generation !== tracking.generation)
			throw new DomainError(
				"TRACKING_CONFLICT",
				"Account changed while reading anime detail.",
			);
		const { entries, ...envelope } = tracking;
		const entry = entries.find((entry) => entry.mediaId === key) ?? null;
		const titles = metadata?.data.titles;
		const displayTitle = workTitle(
			titles ?? [],
			local?.work.displayTitle ?? entry?.titles[0] ?? key,
		);
		this.logger.trace(
			{
				event: "anime.detail_read",
				key,
				local: Boolean(local),
				metadata: Boolean(metadata),
				generation: tracking.generation,
			},
			"Anime detail projection read.",
		);
		return {
			reference,
			displayTitle,
			metadata,
			metadataError,
			local,
			viewing: { ...envelope, entry },
		};
	}
	private projectReference(
		reference: import("../../shared/external-reference.js").ExternalWorkReference,
	) {
		if (!this.associations)
			throw new MetadataError({
				code: "unavailable",
				message: "Work identity resolution is unavailable.",
				retryAt: null,
			});
		return this.associations.referenceForExternal(reference);
	}
	private reference(key: string) {
		try {
			return workReference(key);
		} catch {
			throw new DomainError("INVALID_REQUEST", "Invalid anime work identity.");
		}
	}

	private async findLocal(key: string): Promise<string | null> {
		const reference = this.reference(key);
		if (!this.catalog) return null;
		try {
			return (
				(await this.catalog?.findLocalWork(this.projectReference(reference))) ??
				null
			);
		} catch (error) {
			if (
				error instanceof DomainError &&
				[
					"RESOURCE_ROOT_NOT_CONFIGURED",
					"RESOURCE_ROOT_UNAVAILABLE",
					"CATALOG_UNAVAILABLE",
				].includes(error.code)
			)
				return null;
			throw error;
		}
	}
}
