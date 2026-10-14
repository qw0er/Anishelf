import { resourceRootId } from "../../../resources/public.js";
import type { IdentificationResult } from "../../identification/public.js";
import { conflict, invalid, text } from "../domain/mapping.js";
import type { ReviewItem } from "../domain/model.js";
import type { AnimeCatalogApi } from "../public.js";
import { type CatalogContext, page, safeReview } from "./context.js";

export class ReviewApplication {
	constructor(private readonly context: CatalogContext) {}
	publish(
		results: readonly IdentificationResult[],
		canonicalRoot: string,
	): void {
		this.context.open();
		const rootId = resourceRootId(canonicalRoot);
		if (results.some((result) => result.source.canonicalRoot !== canonicalRoot))
			invalid("A publication must belong to one resource root.");
		const items = results.map((result) => ({
			source: this.context.options.store.registerSource(result.source),
			result: structuredClone(result),
		}));
		this.context.options.store.publish(rootId, items);
		this.context.options.logger.info(
			{ event: "catalog.publication_saved", sources: items.length, rootId },
			"Catalog proposals synchronized; user decisions preserved.",
		);
	}
	private associations(id: string): ReviewItem["associations"] {
		return this.context.options.store.associations(id).map(({ episode }) => {
			const work = this.context.options.store.work(episode.workId);
			return {
				workId: episode.workId,
				workTitle: work?.providerTitle ?? episode.workId,
				episodeId: episode.id,
				kind: episode.kind,
				number: episode.number,
				label: episode.label,
			};
		});
	}
	async source(fileId: string) {
		const root = await this.context.root();
		const resolved = await this.context.options.sources.resolveSource(fileId);
		this.context.options.sources.assertRootEpoch(root.epoch);
		const source = this.context.options.store.registerSource(resolved.identity);
		const record = this.context.options.store.review(source.id);
		return {
			sourceVersion: source.sourceVersion,
			associations:
				record?.available && record.decision === "confirmed"
					? this.associations(source.id)
					: [],
		};
	}
	async get(id: string): Promise<ReviewItem> {
		const root = await this.context.root();
		const record = this.context.requireReview(id, root.rootId);
		return safeReview(
			record,
			await this.context.available(record, root.epoch),
			this.associations(id),
		);
	}
	async reviews(options: Parameters<AnimeCatalogApi["reviews"]>[0] = {}) {
		const root = await this.context.root();
		if (
			options.decision &&
			!["pending", "confirmed", "rejected"].includes(options.decision)
		)
			invalid("Unknown review decision.");
		const pagination = page(options);
		const result = this.context.options.store.reviews(
			root.rootId,
			options.decision,
			pagination.page,
			pagination.perPage,
		);
		const items: ReviewItem[] = [];
		for (const item of result.items)
			items.push(
				safeReview(
					item,
					await this.context.available(item, root.epoch),
					this.associations(item.id),
				),
			);
		this.context.options.sources.assertRootEpoch(root.epoch);
		return { ...result, items };
	}
	private async decision(
		id: string,
		revision: number,
		reason: string,
		remove: boolean,
	): Promise<ReviewItem> {
		const root = await this.context.root();
		const record = this.context.requireReview(id, root.rootId, revision);
		text(reason);
		this.context.options.store.transaction((store) => {
			const associations = store.associations(record.id);
			if (associations.length && !remove)
				conflict(
					"Remove existing associations explicitly before rejecting this source.",
				);
			if (remove) {
				store.replaceAssociations(record.id, []);
				for (const workId of new Set(
					associations.map((item) => item.episode.workId),
				)) {
					const work = store.work(workId);
					const link = store.link(workId);
					if (work && link)
						store.saveWork(
							{ ...work, revision: work.revision + 1, updatedAt: Date.now() },
							link,
						);
				}
			}
			store.decide(record.id, revision, "rejected", reason.trim());
		});
		return safeReview(
			this.context.requireReview(id, root.rootId),
			await this.context.available(record, root.epoch),
		);
	}
	reject(id: string, revision: number, reason: string) {
		return this.decision(id, revision, reason, false);
	}
	remove(id: string, revision: number, reason: string) {
		return this.decision(id, revision, reason, true);
	}
}
