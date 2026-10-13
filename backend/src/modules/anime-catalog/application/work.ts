import { DomainError } from "../../../shared/errors.js";
import { conflict, invalid, target, text } from "../domain/mapping.js";
import type { LocalEpisode, LocalWork, WorkDetail } from "../domain/model.js";
import type { CatalogContext } from "./context.js";
import { projection } from "./projection.js";
import type { CatalogQueries } from "./queries.js";

export class WorkApplication {
	constructor(
		private readonly context: CatalogContext,
		private readonly queries: CatalogQueries,
	) {}
	async editWork(
		id: string,
		revision: number,
		title: string | null,
		aliases: string[],
	): Promise<LocalWork> {
		const root = await this.context.root();
		const work = this.context.requireWork(id, root.rootId);
		if (work.revision !== revision) conflict();
		if (aliases.length > 100) invalid("At most 100 aliases are allowed.");
		const updated = {
			...work,
			title: title === null ? null : text(title),
			aliases: [...new Set(aliases.map((alias) => text(alias)))],
			revision: work.revision + 1,
			updatedAt: Date.now(),
		};
		const link = this.context.options.store.link(id);
		if (!link) throw new Error("Provider link is missing.");
		this.context.options.store.transaction((store) => {
			if (store.work(id)?.revision !== revision) conflict();
			store.saveWork(updated, link);
		});
		return updated;
	}
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
		return updated;
	}
	async refresh(id: string, revision: number): Promise<WorkDetail> {
		const root = await this.context.root();
		const work = this.context.requireWork(id, root.rootId);
		if (work.revision !== revision) conflict();
		const link = this.context.options.store.link(id);
		if (!link) throw new Error("Provider link is missing.");
		const metadata = await this.context.options.metadata.get(link.reference, {
			refresh: true,
		});
		this.context.options.sources.assertRootEpoch(root.epoch);
		this.context.open();
		if (metadata.refreshError) return this.queries.detail(id);
		this.context.options.metadata.retain(metadata.snapshotId, id);
		try {
			this.context.options.store.transaction((store) => {
				if (store.work(id)?.revision !== revision) conflict();
				store.saveWork(
					projection(
						{ ...work, revision: revision + 1, updatedAt: Date.now() },
						metadata.data,
					),
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
		if (link.snapshotId !== metadata.snapshotId)
			this.context.options.metadata.release(link.snapshotId, id);
		return this.queries.detail(id);
	}
}
