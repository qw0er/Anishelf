import { eq } from "drizzle-orm";
import {
	mediaSources,
	resourceRoots,
	subtitleAssets,
	subtitleFontAssets,
	subtitleFontSets,
} from "../../../platform/database/schema.js";
import type { Store } from "../../../platform/database/store.js";
import type { SourceRegistry } from "../../resource-access/public.js";
import type { SubtitleAsset, SubtitleFontSet } from "../domain/model.js";

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
	saveFonts(set: SubtitleFontSet): void {
		this.store.transaction(() => {
			const source = this.sources.registerSource(set.source);
			this.store
				.insert(subtitleFontSets)
				.values({
					id: set.id,
					sourceId: source.id,
					status: set.status,
					warnings: set.warnings,
				})
				.onConflictDoUpdate({
					target: subtitleFontSets.id,
					set: { status: set.status, warnings: set.warnings },
				})
				.run();
			this.store
				.delete(subtitleFontAssets)
				.where(eq(subtitleFontAssets.setId, set.id))
				.run();
			for (const asset of set.assets)
				this.store
					.insert(subtitleFontAssets)
					.values({ ...asset, setId: set.id })
					.run();
		});
	}
	private fontQuery() {
		return this.store
			.select({
				set: subtitleFontSets,
				source: mediaSources,
				root: resourceRoots,
			})
			.from(subtitleFontSets)
			.innerJoin(mediaSources, eq(subtitleFontSets.sourceId, mediaSources.id))
			.innerJoin(resourceRoots, eq(mediaSources.rootId, resourceRoots.id));
	}
	private toFonts({
		set,
		source,
		root,
	}: {
		set: typeof subtitleFontSets.$inferSelect;
		source: typeof mediaSources.$inferSelect;
		root: typeof resourceRoots.$inferSelect;
	}): SubtitleFontSet {
		return {
			id: set.id,
			status: set.status,
			warnings: set.warnings,
			source: {
				canonicalRoot: root.canonicalPath,
				fileId: source.fileId,
				relativePath: source.relativePath,
				sourceVersion: source.sourceVersion,
			},
			assets: this.store
				.select()
				.from(subtitleFontAssets)
				.where(eq(subtitleFontAssets.setId, set.id))
				.all()
				.map(({ setId: _setId, ...asset }) => asset),
		};
	}
	listFonts(): SubtitleFontSet[] {
		return this.fontQuery()
			.all()
			.map((row) => this.toFonts(row));
	}
	getFonts(id: string): SubtitleFontSet | undefined {
		const row = this.fontQuery().where(eq(subtitleFontSets.id, id)).get();
		return row ? this.toFonts(row) : undefined;
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
