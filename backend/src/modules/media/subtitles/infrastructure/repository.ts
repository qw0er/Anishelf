import { eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import { mediaSources } from "../../../resources/persistence.js";
import type { SourceRegistry } from "../../../resources/public.js";
import type { SubtitleAsset, SubtitleFontSet } from "../domain/model.js";
import { readSubtitleFontSets, writeSubtitleFontSets } from "./records.js";
import {
	subtitleAssets,
	subtitleFontAssets,
	subtitleFontSets,
} from "./schema.js";
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
			writeSubtitleFontSets(this.store, {
				id: set.id,
				sourceId: source.id,
				status: set.status,
				warnings: set.warnings,
			});
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
			})
			.from(subtitleFontSets)
			.innerJoin(mediaSources, eq(subtitleFontSets.sourceId, mediaSources.id));
	}
	private toFonts({
		set,
		source,
	}: {
		set: typeof subtitleFontSets.$inferSelect;
		source: typeof mediaSources.$inferSelect;
	}): SubtitleFontSet {
		return {
			id: set.id,
			status: set.status,
			warnings: readSubtitleFontSets(this.store, set).warnings,
			source: {
				scopeId: source.rootId,
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
			})
			.from(subtitleAssets)
			.innerJoin(mediaSources, eq(subtitleAssets.sourceId, mediaSources.id));
	}
	private toAsset({
		asset,
		source,
	}: {
		asset: typeof subtitleAssets.$inferSelect;
		source: typeof mediaSources.$inferSelect;
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
				scopeId: source.rootId,
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
