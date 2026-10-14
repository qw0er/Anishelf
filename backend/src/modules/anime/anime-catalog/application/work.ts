import { DomainError } from "../../../../shared/errors.js";
import {
	type CachedMetadata,
	MetadataError,
	type MetadataFailure,
	type WorkDetails,
} from "../../metadata/public.js";
import { conflict, target, text } from "../domain/mapping.js";
import type {
	LocalEpisode,
	LocalWork,
	ProviderLink,
	WorkDetail,
} from "../domain/model.js";
import type { CatalogContext } from "./context.js";
import { projection } from "./projection.js";
import type { CatalogQueries } from "./queries.js";

export class WorkApplication {
	constructor(
		private readonly context: CatalogContext,
		private readonly queries: CatalogQueries,
	) {}
	async editEpisode(
		id: string,
		episodeId: string,
		revision: number,
		number: string,
		label: string,
	): Promise<LocalEpisode> {
		const root = await this.context.root();
		const work = this.context.requireWork(id, root.rootId);
		if (work.revision !== revision) conflict();
		const episodes = this.context.options.store.episodes(id);
		const episode = episodes.find((item) => item.id === episodeId);
		if (!episode)
			throw new DomainError("CATALOG_NOT_FOUND", "Episode was not found.");
		const value = target(
			{ kind: episode.kind, number, label },
			work.episodeCount,
			work.format,
		);
		if (
			episodes.some(
				(item) =>
					item.id !== episodeId &&
					item.kind === value.kind &&
					item.number === value.number,
			)
		)
			conflict("Another episode already uses that identity.");
		const updated: LocalEpisode = {
			...episode,
			number: value.number,
			label: text(label),
			provenance: "confirmed",
		};
		const link = this.context.options.store.link(id);
		if (!link) throw new Error("Provider link is missing.");
		this.context.options.store.transaction((store) => {
			if (store.work(id)?.revision !== revision) conflict();
			store.saveEpisode(updated);
			store.saveWork(
				{ ...work, revision: revision + 1, updatedAt: Date.now() },
				link,
			);
		});
		this.context.options.logger.info(
			{
				event: "catalog.episode_edited",
				workId: id,
				episodeId,
				revision: revision + 1,
			},
			"Catalog episode identity updated.",
		);
		return updated;
	}
	async refresh(id: string, revision: number): Promise<WorkDetail> {
		const started = performance.now();
		const root = await this.context.root();
		const work = this.context.requireWork(id, root.rootId);
		if (work.revision !== revision) conflict();
		this.context.options.logger.debug(
			{ event: "catalog.refresh_requested", workId: id, revision },
			"Manual catalog refresh requested.",
		);
		const link = this.context.options.store.link(id);
		if (!link) throw new Error("Provider link is missing.");
		const metadata = await this.context.options.metadata.get(link.reference, {
			refresh: true,
		});
		this.context.options.sources.assertRootEpoch(root.epoch);
		this.context.open();
		if (!metadata.refreshError) this.apply(work, link, metadata);
		this.context.options.logger.info(
			{
				event: "catalog.refresh_completed",
				workId: id,
				retained: Boolean(metadata.refreshError),
				code: metadata.refreshError?.code,
				elapsedMs: Math.round(performance.now() - started),
			},
			"Manual catalog refresh completed.",
		);

		return this.queries.detail(id);
	}
	async revalidate(
		id: string,
		signal: AbortSignal,
	): Promise<MetadataFailure | null> {
		this.context.open();
		const work = this.context.options.store.work(id);
		const link = this.context.options.store.link(id);
		if (!work || !link) return null;
		let metadata: CachedMetadata<WorkDetails>;
		try {
			metadata = await this.context.options.metadata.get(link.reference, {
				cachedOnly: true,
				signal,
			});
		} catch (error) {
			if (
				!(error instanceof MetadataError) ||
				error.failure.code !== "not-found"
			)
				throw error;
			// A retained snapshot may use an older adapter/projection cache key after an upgrade.
			metadata = await this.context.options.metadata.get(link.reference, {
				refresh: true,
				signal,
			});
		}
		if (metadata.stale) {
			if (
				metadata.refreshError?.retryAt &&
				metadata.refreshError.retryAt > Date.now()
			)
				return metadata.refreshError;
			metadata = await this.context.options.metadata.get(link.reference, {
				refresh: true,
				signal,
			});
		}
		signal.throwIfAborted();
		this.context.open();
		if (metadata.refreshError) return metadata.refreshError;
		// Automatic updates yield to local edits and confirmations; a later pass adopts the cached result.
		if (
			this.context.options.store.work(id)?.revision !== work.revision ||
			this.context.options.store.link(id)?.snapshotId !== link.snapshotId
		)
			return null;
		this.apply(work, link, metadata);
		return null;
	}
	private apply(
		work: LocalWork,
		link: ProviderLink,
		metadata: CachedMetadata<WorkDetails>,
	): void {
		const id = work.id;
		if (
			link.snapshotId !== metadata.snapshotId &&
			this.context.options.store.link(id)?.snapshotId === metadata.snapshotId &&
			this.context.options.store.work(id)?.revision === work.revision + 1
		)
			return;
		if (this.context.options.store.work(id)?.revision !== work.revision)
			conflict();
		const projected = projection(work, metadata.data);
		if (
			link.snapshotId === metadata.snapshotId &&
			JSON.stringify(projected) === JSON.stringify(work)
		)
			return;
		this.context.options.metadata.retain(metadata.snapshotId, id);
		try {
			this.context.options.store.transaction((store) => {
				if (
					store.work(id)?.revision !== work.revision ||
					store.link(id)?.snapshotId !== link.snapshotId
				)
					conflict();
				store.saveWork(
					{ ...projected, revision: work.revision + 1, updatedAt: Date.now() },
					{ ...link, snapshotId: metadata.snapshotId },
				);
			});
		} catch (error) {
			if (
				this.context.options.store.link(id)?.snapshotId !== metadata.snapshotId
			)
				this.context.options.metadata.release(metadata.snapshotId, id);
			throw error;
		}
		this.context.options.logger.info(
			{
				event: "catalog.metadata_updated",
				workId: id,
				provider: link.reference.provider,
				snapshotId: metadata.snapshotId,
				revision: work.revision + 1,
			},
			"Catalog adopted updated metadata.",
		);
		if (link.snapshotId !== metadata.snapshotId)
			this.context.options.metadata.release(link.snapshotId, id);
	}
}
