import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import {
	type ResourceAccessApi,
	resourceRootId,
} from "../../../resources/public.js";
import { automaticBlockers } from "../domain/admission.js";
import { conflict, integer, text } from "../domain/mapping.js";
import type { LocalWork, ReviewItem, ReviewRecord } from "../domain/model.js";
import { catalogPolicy as policy } from "../policy.js";
import type { CatalogMetadata, CatalogStore } from "../ports.js";

export function page(options: { page?: number; perPage?: number }) {
	return {
		page: integer(options.page ?? 1, 1, 100000),
		perPage: integer(options.perPage ?? 20, 1, policy.maximumPageSize),
	};
}

export interface CatalogOptions {
	store: CatalogStore;
	metadata: CatalogMetadata;
	sources: ResourceAccessApi;
	logger: Logger;
}

export function safeReview(
	record: ReviewRecord,
	available: boolean,
	associations: ReviewItem["associations"] = [],
): ReviewItem {
	const { canonicalRoot: _, ...item } = record;
	return {
		...item,
		available,
		associations,
		unresolved: [
			...new Set([
				...item.unresolved,
				...(item.decision === "pending"
					? automaticBlockers({ ...record, available })
					: []),
			]),
		],
	};
}

/** Shared lifecycle and resource-root checks for all Catalog use cases. */
export class CatalogContext {
	private closed = false;
	constructor(readonly options: CatalogOptions) {}
	open(): void {
		if (this.closed)
			throw new DomainError("CATALOG_UNAVAILABLE", "Catalog is closed.");
	}
	async root() {
		this.open();
		const epoch = this.options.sources.resourceRootEpoch;
		const canonicalRoot = await this.options.sources.resolveRoot();
		this.options.sources.assertRootEpoch(epoch);
		return { canonicalRoot, epoch, rootId: resourceRootId(canonicalRoot) };
	}
	requireReview(id: string, rootId: string, revision?: number): ReviewRecord {
		const record = this.options.store.review(text(id, 200));
		if (!record || record.rootId !== rootId)
			throw new DomainError(
				"CATALOG_NOT_FOUND",
				"Review item is not in the active root.",
			);
		if (
			revision !== undefined &&
			record.revision !== integer(revision, 1, Number.MAX_SAFE_INTEGER)
		)
			conflict();
		return record;
	}
	requireWork(id: string, rootId: string): LocalWork {
		const work = this.options.store.work(text(id, 200));
		if (
			!work ||
			!this.options.store
				.episodes(id)
				.some(
					(episode) => this.options.store.versions(episode.id, rootId).length,
				)
		)
			throw new DomainError(
				"CATALOG_NOT_FOUND",
				"Work is not in the active root.",
			);
		return work;
	}
	async available(record: ReviewRecord, epoch: number): Promise<boolean> {
		if (!record.available || !this.options.sources.hasSnapshot) return false;
		try {
			await this.options.sources.revalidateSource({
				rootEpoch: epoch,
				identity: {
					canonicalRoot: record.canonicalRoot,
					fileId: record.fileId,
					relativePath: record.relativePath,
					sourceVersion: record.sourceVersion,
				},
			});
			return true;
		} catch (error) {
			this.options.sources.assertRootEpoch(epoch);
			if (
				error instanceof DomainError &&
				[
					"RESOURCE_NOT_FOUND",
					"RESOURCE_MISSING",
					"RESOURCE_UNREADABLE",
					"RESOURCE_ACCESS_DENIED",
					"RESOURCE_ROOT_UNAVAILABLE",
					"PLAYBACK_CONFLICT",
				].includes(error.code)
			)
				return false;
			throw error;
		}
	}
	async validate(record: ReviewRecord, epoch: number): Promise<void> {
		if (!(await this.available(record, epoch)))
			conflict(
				"The selected source is unavailable or replaced. Scan and review it again.",
			);
	}

	close(): void {
		this.closed = true;
	}
}
