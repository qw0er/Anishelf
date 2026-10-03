import { eq } from "drizzle-orm";
import {
	mediaSources,
	resourceRoots,
	subtitleAssets,
} from "../../../platform/database/schema.js";
import type { Store } from "../../../platform/database/store.js";
import type { SourceRegistry } from "../../media-source/public.js";
import type { SubtitleAsset } from "../domain/model.js";

export class SubtitleRepository {
	constructor(
		private readonly store: Store,
		private readonly sources: SourceRegistry,
	) {}
	save(asset: SubtitleAsset): void {
		this.store.transaction(() => {
			const source = this.sources.registerSource(asset.source);
			this.store
				.insert(subtitleAssets)
				.values({
					id: asset.id,
					sourceId: source.id,
					trackId: asset.trackId,
					streamIndex: asset.streamIndex,
					processingVersion: asset.processingVersion,
					format: asset.format,
					status: asset.status,
					sizeBytes: asset.sizeBytes,
					errorCode: asset.errorCode,
					updatedAtMs: Date.now(),
				})
				.onConflictDoUpdate({
					target: subtitleAssets.id,
					set: {
						status: asset.status,
						sizeBytes: asset.sizeBytes,
						errorCode: asset.errorCode,
						updatedAtMs: Date.now(),
					},
				})
				.run();
		});
	}
	private query() {
		return this.store
			.select({
				asset: subtitleAssets,
				source: mediaSources,
				root: resourceRoots,
			})
			.from(subtitleAssets)
			.innerJoin(mediaSources, eq(subtitleAssets.sourceId, mediaSources.id))
			.innerJoin(resourceRoots, eq(mediaSources.rootId, resourceRoots.id));
	}
	private toAsset({
		asset,
		source,
		root,
	}: {
		asset: typeof subtitleAssets.$inferSelect;
		source: typeof mediaSources.$inferSelect;
		root: typeof resourceRoots.$inferSelect;
	}): SubtitleAsset {
		return {
			id: asset.id,
			trackId: asset.trackId,
			streamIndex: asset.streamIndex,
			processingVersion: asset.processingVersion,
			format: asset.format,
			status: asset.status,
			sizeBytes: asset.sizeBytes,
			errorCode: asset.errorCode,
			source: {
				canonicalRoot: root.canonicalPath,
				fileId: source.fileId,
				relativePath: source.relativePath,
				sourceVersion: source.sourceVersion,
			},
		};
	}
	list(): SubtitleAsset[] {
		return this.query()
			.all()
			.map((row) => this.toAsset(row));
	}
	get(id: string): SubtitleAsset | undefined {
		const row = this.query().where(eq(subtitleAssets.id, id)).get();
		return row ? this.toAsset(row) : undefined;
	}
}
