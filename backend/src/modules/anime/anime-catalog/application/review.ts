import { DomainError } from "../../../../shared/errors.js";
import type { IdentificationResult } from "../../identification/public.js";
import { conflict, invalid, text } from "../domain/mapping.js";
import type { ReviewItem } from "../domain/model.js";
import type { AnimeCatalogApi } from "../public.js";
import { type CatalogContext, page, safeReview } from "./context.js";

export class ReviewApplication {
	constructor(private readonly context: CatalogContext) {}
	publish(
		results: readonly IdentificationResult[],
		scopeIds: readonly string[],
		fileIds?: readonly string[],
	): void {
		this.context.open();

		if (results.some((result) => !scopeIds.includes(result.source.scopeId)))
			invalid("A publication must belong to one resource root.");
		if (fileIds !== undefined) {
			const scope = new Set(fileIds);
			if (results.some((result) => !scope.has(result.source.fileId)))
				invalid("Incremental results must belong to the declared file scope.");
		}
		const items = results.map((result) => ({
			source: this.context.options.store.registerSource(result.source),
			result: structuredClone(result),
		}));
		this.context.options.store.publish(scopeIds, items, fileIds);
		this.context.options.logger.info(
			{
				event: "catalog.publication_saved",
				sources: items.length,
				scopeIds,
				scope: fileIds === undefined ? "full" : "incremental",
				affectedFiles: fileIds?.length,
			},
			"Catalog proposals synchronized; user decisions preserved.",
		);
	}
	private associations(id: string): ReviewItem["associations"] {
		return this.context.options.store.associations(id).map(({ episode }) => {
			const work = this.context.options.store.work(episode.workId);
			const reference = this.context.options.store.link(
				episode.workId,
			)?.reference;
			return {
				workId: episode.workId,
				workTitle: work?.providerTitle ?? episode.workId,
				...(reference ? { reference } : {}),
				episodeId: episode.id,
				kind: episode.kind,
				number: episode.number,
				label: episode.label,
			};
		});
	}
	async source(fileId: string) {
		const scope = await this.context.scope();
		const resolved = await this.context.options.sources.resolveSource(fileId);
		this.context.options.sources.assertAccessRevision(scope.revision);
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
	async fileReviews(fileIds: string[]): Promise<ReviewItem[]> {
		if (fileIds.length > 100 || new Set(fileIds).size !== fileIds.length)
			invalid("Select at most 100 distinct files.");
		const scope = await this.context.scope();
		const items: ReviewItem[] = [];
		for (const fileId of fileIds) {
			text(fileId, 200);
			try {
				const resolved =
					await this.context.options.sources.resolveSource(fileId);
				this.context.options.sources.assertAccessRevision(scope.revision);
				const source = this.context.options.store.registerSource(
					resolved.identity,
				);
				const record = this.context.options.store.review(source.id);
				if (record)
					items.push(
						safeReview(
							record,
							await this.context.available(record, scope.revision),
							this.associations(record.id),
						),
					);
			} catch (error) {
				this.context.options.sources.assertAccessRevision(scope.revision);
				if (
					!(error instanceof DomainError) ||
					![
						"RESOURCE_NOT_FOUND",
						"RESOURCE_MISSING",
						"RESOURCE_UNREADABLE",
						"RESOURCE_ACCESS_DENIED",
					].includes(error.code)
				)
					throw error;
			}
		}
		this.context.options.sources.assertAccessRevision(scope.revision);
		return items;
	}
	async get(id: string): Promise<ReviewItem> {
		const scope = await this.context.scope();
		const record = this.context.requireReview(id, scope.ids);
		return safeReview(
			record,
			await this.context.available(record, scope.revision),
			this.associations(id),
		);
	}
	async reviews(options: Parameters<AnimeCatalogApi["reviews"]>[0] = {}) {
		const scope = await this.context.scope();
		if (
			options.decision &&
			!["pending", "confirmed", "rejected"].includes(options.decision)
		)
			invalid("Unknown review decision.");
		const reference = options.workId
			? (() => {
					this.context.requireWork(options.workId, scope.ids);
					const link = this.context.options.store.link(options.workId);
					if (!link) throw new Error("Provider link is missing.");
					return link.reference;
				})()
			: undefined;
		const pagination = page(options);
		const result = this.context.options.store.reviews(
			scope.ids,
			options.decision,
			pagination.page,
			pagination.perPage,
			reference,
		);
		const items: ReviewItem[] = [];
		for (const item of result.items)
			items.push(
				safeReview(
					item,
					await this.context.available(item, scope.revision),
					this.associations(item.id),
				),
			);
		this.context.options.sources.assertAccessRevision(scope.revision);
		return { ...result, items };
	}
	private async decision(
		id: string,
		revision: number,
		reason: string,
		remove: boolean,
	): Promise<ReviewItem> {
		const scope = await this.context.scope();
		const record = this.context.requireReview(id, scope.ids, revision);
		if (remove || reason.trim()) text(reason);
		else if (reason.length > 500)
			invalid("Reason must be at most 500 characters.");
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
			store.decide(record.id, revision, "rejected", reason.trim() || null);
		});
		this.context.options.logger.info(
			{
				event: remove ? "catalog.associations_removed" : "catalog.rejected",
				reviewId: id,
				scopeIds: scope.ids,
				revision: revision + 1,
			},
			remove
				? "Catalog associations removed and source rejected."
				: "Catalog source rejected.",
		);
		return safeReview(
			this.context.requireReview(id, scope.ids),
			await this.context.available(record, scope.revision),
		);
	}
	reject(id: string, revision: number, reason: string) {
		return this.decision(id, revision, reason, false);
	}
	remove(id: string, revision: number, reason: string) {
		return this.decision(id, revision, reason, true);
	}
}
