import { randomUUID } from "node:crypto";
import { DomainError } from "../../../../shared/errors.js";
import { MetadataError } from "../../metadata/public.js";
import { conflict, invalid, targets, text } from "../domain/mapping.js";
import type {
	CatalogPreview,
	Confirmation,
	ConfirmationResult,
	LocalEpisode,
	PreviewRequest,
	ReviewRecord,
} from "../domain/model.js";
import { catalogPolicy as policy } from "../policy.js";
import type { CatalogContext } from "./context.js";
import { projection } from "./projection.js";

interface SavedPreview {
	value: CatalogPreview;
	scopeIds: readonly string[];
	epoch: number;
	sources: ReviewRecord[];
	affectedWorks: { id: string; revision: number }[];
}

export class AssociationApplication {
	private previews = new Map<string, SavedPreview>();
	constructor(private readonly context: CatalogContext) {}
	private prunePreviews(): void {
		for (const [id, saved] of this.previews)
			if (saved.value.expiresAt <= Date.now()) {
				this.previews.delete(id);
			}
	}
	async preview(
		request: PreviewRequest,
		signal?: AbortSignal,
	): Promise<CatalogPreview> {
		const scope = await this.context.scope();
		this.prunePreviews();
		if (this.previews.size >= policy.maximumPreviews)
			throw new DomainError(
				"CATALOG_UNAVAILABLE",
				"Too many pending previews; retry after they expire.",
			);
		if (
			!request.rows.length ||
			request.rows.length > policy.maximumRows ||
			new Set(request.rows.map((row) => row.reviewId)).size !==
				request.rows.length
		)
			invalid("Select between one and 100 distinct review items.");
		const metadata = await this.context.options.metadata.get(
			request.reference,
			signal ? { signal } : {},
		);
		this.context.options.sources.assertAccessRevision(scope.revision);
		const records: ReviewRecord[] = [];
		const rows: CatalogPreview["rows"] = [];
		const affectedWorks = new Map<string, number>();
		for (const selection of request.rows) {
			const record = this.context.requireReview(
				selection.reviewId,
				scope.ids,
				selection.revision,
			);
			await this.context.validate(record, scope.revision);
			const before = this.context.options.store
				.associations(record.sourceId)
				.map(({ episode }) => ({
					workId: episode.workId,
					episodeId: episode.id,
					kind: episode.kind,
					number: episode.number,
				}));
			for (const previous of before) {
				const previousWork = this.context.options.store.work(previous.workId);
				if (!previousWork) throw new Error("Association work is missing.");
				affectedWorks.set(previousWork.id, previousWork.revision);
			}
			records.push(record);
			rows.push({
				reviewId: record.id,
				revision: record.revision,
				relativePath: record.relativePath,
				rawNumbers: record.evidence.rawEpisodes,
				before,
				targets: targets(selection, metadata.data),
				offset: selection.offset ?? 0,
				reason: text(selection.reason),
			});
		}
		const work = this.context.options.store.findWork(request.reference);
		if (work) affectedWorks.set(work.id, work.revision);
		const value: CatalogPreview = {
			id: randomUUID(),
			expiresAt: Date.now() + policy.previewTtlMs,
			reference: metadata.data.reference,
			workId: work?.id ?? null,
			workRevision: work?.revision ?? null,
			metadata,
			rows,
		};
		this.context.options.sources.assertAccessRevision(scope.revision);
		this.context.open();
		if (this.previews.size >= policy.maximumPreviews)
			throw new DomainError(
				"CATALOG_UNAVAILABLE",
				"Too many pending previews; retry after they expire.",
			);
		this.previews.set(value.id, {
			value,
			sources: records,
			scopeIds: scope.ids,
			epoch: scope.revision,
			affectedWorks: [...affectedWorks].map(([id, revision]) => ({
				id,
				revision,
			})),
		});
		return structuredClone(value);
	}
	async confirm(
		request: Confirmation,
		signal?: AbortSignal,
	): Promise<ConfirmationResult> {
		signal?.throwIfAborted();
		this.context.open();
		text(request.operationKey, 200);
		text(request.previewId, 200);
		if (typeof request.replace !== "boolean")
			invalid(
				"Specify whether this confirmation explicitly replaces existing links.",
			);
		const fingerprint = JSON.stringify([request.previewId, request.replace]);
		const completed = this.context.options.store.operation(
			request.operationKey,
		);
		if (completed) {
			if (completed.fingerprint !== fingerprint)
				conflict(
					"Operation key was already used for a different confirmation.",
				);
			this.context.options.logger.debug(
				{
					event: "catalog.confirmation_reused",
					workId: completed.result.workId,
					previewId: request.previewId,
				},
				"Returning an already committed confirmation.",
			);
			return completed.result;
		}
		this.prunePreviews();
		const saved = this.previews.get(request.previewId);
		if (!saved)
			conflict(
				"Preview expired or the server restarted. Create a new preview.",
			);
		const scope = await this.context.scope();
		if (
			saved.epoch !== scope.revision ||
			JSON.stringify(saved.scopeIds) !== JSON.stringify(scope.ids)
		)
			conflict("The resource root changed. Create a new preview.");
		for (const record of saved.sources)
			await this.context.validate(record, scope.revision);
		this.context.options.sources.assertAccessRevision(scope.revision);
		this.context.open();
		signal?.throwIfAborted();
		const preview = saved.value;
		if (preview.expiresAt <= Date.now())
			conflict("Preview expired. Create a new preview.");
		const previousLink = preview.workId
			? this.context.options.store.link(preview.workId)
			: null;
		const targetWorkId = preview.workId ?? randomUUID();
		try {
			this.context.options.metadata.snapshot(preview.metadata.snapshotId);
		} catch (error) {
			if (error instanceof MetadataError && error.failure.code === "not-found")
				conflict("Preview metadata was evicted. Create a new preview.");
			throw error;
		}
		this.context.options.metadata.retain(
			preview.metadata.snapshotId,
			targetWorkId,
		);
		let result: ConfirmationResult;
		try {
			result = this.context.options.store.transaction((store) => {
				const repeated = store.operation(request.operationKey);
				if (repeated) {
					if (repeated.fingerprint !== fingerprint) conflict();
					return repeated.result;
				}
				const existing = store.findWork(preview.reference);
				if (
					(existing?.id ?? null) !== preview.workId ||
					(existing?.revision ?? null) !== preview.workRevision
				)
					conflict();
				for (const affected of saved.affectedWorks)
					if (store.work(affected.id)?.revision !== affected.revision)
						conflict();
				for (const row of preview.rows) {
					const record = store.review(row.reviewId);
					if (!record || record.revision !== row.revision) conflict();
					if (store.associations(row.reviewId).length && !request.replace)
						conflict("Existing associations require explicit replacement.");
				}
				const now = Date.now();
				const work = projection(
					existing ?? {
						id: targetWorkId,
						providerTitle: "",
						searchTitles: [],
						format: null,
						year: null,
						episodeCount: null,
						revision: 0,
						createdAt: now,
						updatedAt: now,
					},
					preview.metadata.data,
				);
				work.revision += 1;
				work.updatedAt = now;
				store.saveWork(work, {
					workId: work.id,
					reference: preview.reference,
					snapshotId: preview.metadata.snapshotId,
				});
				const episodes = store.episodes(work.id);
				const episodeIndex = new Map(
					episodes.map((episode) => [
						`${episode.kind}:${episode.number}`,
						episode,
					]),
				);
				if (
					work.format !== "MOVIE" &&
					work.episodeCount !== null &&
					work.episodeCount <= policy.maximumEpisode
				) {
					for (let number = 1; number <= work.episodeCount; number++) {
						if (episodeIndex.has(`regular:${number}`)) continue;
						const episode: LocalEpisode = {
							id: randomUUID(),
							workId: work.id,
							kind: "regular",
							number: String(number),
							label: `Episode ${number}`,
							provenance: "count-derived",
						};
						store.saveEpisode(episode);
						episodes.push(episode);
						episodeIndex.set(`${episode.kind}:${episode.number}`, episode);
					}
				}
				for (const row of preview.rows) {
					const associations = row.targets.map((value) => {
						let episode = episodeIndex.get(`${value.kind}:${value.number}`);
						if (!episode) {
							episode = {
								id: randomUUID(),
								workId: work.id,
								kind: value.kind,
								number: value.number,
								label:
									value.label ??
									(value.kind === "regular"
										? `Episode ${value.number}`
										: "Movie"),
								provenance: "confirmed",
							};
							store.saveEpisode(episode);
							episodes.push(episode);
							episodeIndex.set(`${episode.kind}:${episode.number}`, episode);
						}
						if (episode.provenance === "count-derived") {
							episode.provenance = "confirmed";
							if (value.label) episode.label = value.label;
							store.saveEpisode(episode);
						} else if (value.label && value.label !== episode.label)
							conflict(
								"An existing episode has a different label. Edit that episode explicitly.",
							);
						return {
							sourceId: row.reviewId,
							episodeId: episode.id,
							rawNumbers: row.rawNumbers,
							reason: row.reason,
							operationKey: request.operationKey,
							offset: row.offset,
						};
					});
					store.replaceAssociations(row.reviewId, associations);
					store.decide(row.reviewId, row.revision, "confirmed", row.reason);
				}
				for (const affected of saved.affectedWorks)
					if (affected.id !== work.id) {
						const previous = store.work(affected.id);
						const link = store.link(affected.id);
						if (previous && link)
							store.saveWork(
								{
									...previous,
									revision: previous.revision + 1,
									updatedAt: now,
								},
								link,
							);
					}
				const committed = {
					workId: work.id,
					revision: work.revision,
					reviewIds: preview.rows.map((row) => row.reviewId),
				};
				store.saveOperation(request.operationKey, fingerprint, committed);
				return committed;
			});
		} catch (error) {
			if (
				this.context.options.store.link(targetWorkId)?.snapshotId !==
				preview.metadata.snapshotId
			)
				this.context.options.metadata.release(
					preview.metadata.snapshotId,
					targetWorkId,
				);
			throw error;
		}
		if (result.workId !== targetWorkId)
			this.context.options.metadata.release(
				preview.metadata.snapshotId,
				targetWorkId,
			);
		this.previews.delete(preview.id);
		if (previousLink && previousLink.snapshotId !== preview.metadata.snapshotId)
			this.context.options.metadata.release(
				previousLink.snapshotId,
				result.workId,
			);
		this.context.options.logger.info(
			{
				event: "catalog.confirmed",
				workId: result.workId,
				sources: result.reviewIds.length,
				previewId: request.previewId,
				revision: result.revision,
				replace: request.replace,
			},
			"Catalog associations confirmed.",
		);
		return result;
	}

	discard(id: string): void {
		this.previews.delete(id);
	}
	close(): void {
		this.previews.clear();
	}
}
