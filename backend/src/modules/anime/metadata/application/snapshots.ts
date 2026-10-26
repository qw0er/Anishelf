import { createHash } from "node:crypto";
import type { Logger } from "pino";
import { metadataDefaults } from "../defaults.js";
import type {
	CachedMetadata,
	MetadataSnapshot,
	WorkDetails,
	WorkSummary,
} from "../domain/model.js";
import type {
	ArtworkEvidence,
	ProjectDocument,
} from "../domain/project-document.js";
import { projectDetails, projectSummary } from "../domain/projection.js";
import type * as Source from "../domain/source-model.js";
import type { MetadataStore, SourceMetadataApi } from "../ports.js";
import type { MetadataIdentities } from "./identities.js";
import { metadataStorage } from "./operations.js";
import { projectEnvelope, projectPage } from "./results.js";

export class MetadataSnapshots {
	constructor(
		private readonly source: Pick<SourceMetadataApi, "snapshot">,
		private readonly store: Pick<
			MetadataStore,
			"get" | "save" | "touch" | "prune"
		>,
		private readonly identities: Pick<
			MetadataIdentities,
			"referenceForExternal" | "originalReference"
		>,
		private readonly logger?: Logger,
	) {}
	private storage<T>(operation: () => T): T {
		return metadataStorage(operation, this.logger);
	}
	document(id: string): ProjectDocument | null {
		const entry = this.storage(() => this.store.get(id));
		return entry?.key.startsWith("project:")
			? (entry.data as ProjectDocument)
			: null;
	}
	save<T>(
		kind: MetadataSnapshot["kind"],
		value: CachedMetadata<T>,
		artwork: ArtworkEvidence = {},
	): CachedMetadata<T> {
		// Self-contained, immutable project evidence survives source cache eviction and association changes.
		const id = `project:${createHash("sha256")
			.update(JSON.stringify([kind, value.snapshotId, value.data, artwork]))
			.digest("hex")}`;
		const result = { ...value, snapshotId: id };
		const sourceIds = value.snapshotId.split(":").filter(Boolean);
		const entries = sourceIds.flatMap((id) => {
			const entry = this.store.get(id);
			return entry ? [entry] : [];
		});
		const data: ProjectDocument = {
			sourceIds,
			project: { kind, ...result } as MetadataSnapshot,
			artwork,
		};
		this.storage(() =>
			this.store.save({
				id,
				key: id,
				kind,
				data,
				fetchedAt: value.fetchedAt,
				expiresAt: entries.length
					? Math.min(...entries.map((entry) => entry.expiresAt))
					: Date.now() + metadataDefaults.detailFreshMs,
				accessedAt: Date.now(),
				failure: null,
			}),
		);
		this.storage(() =>
			this.store.prune(metadataDefaults.searchKeys, metadataDefaults.snapshots),
		);
		return result;
	}
	private legacySummary(work: Source.WorkSummary): WorkSummary {
		const data = projectSummary(
			work,
			this.identities.referenceForExternal(work.reference),
		);
		data.reference = this.identities.originalReference(work.reference);
		if (data.coverUrl)
			data.coverUrl = `/api/metadata/${data.reference.id}/artwork/cover/image`;
		return data;
	}
	private legacyDetails(work: Source.WorkDetails): WorkDetails {
		const data = {
			...projectDetails(
				work,
				this.identities.referenceForExternal(work.reference),
			),
			...this.legacySummary(work),
		};
		if (data.bannerUrl)
			data.bannerUrl = `/api/metadata/${data.reference.id}/artwork/banner/image`;
		return data;
	}
	/** Project retained evidence as well as live reads; provenance never crosses this boundary. */
	private project(snapshot: Source.MetadataSnapshot): MetadataSnapshot {
		switch (snapshot.kind) {
			case "search":
				return {
					kind: "search",
					...projectEnvelope(snapshot, (data) =>
						projectPage(data, (item) => this.legacySummary(item)),
					),
				};
			case "detail":
				return {
					kind: "detail",
					...projectEnvelope(snapshot, (data) => this.legacyDetails(data)),
				};
			case "relations":
				return {
					kind: "relations",
					...projectEnvelope(snapshot, (data) =>
						projectPage(data, (item) => ({
							type: item.type,
							work: this.legacySummary(item.work),
						})),
					),
				};
			case "airing":
				return {
					kind: "airing",
					...projectEnvelope(snapshot, (data) =>
						projectPage(data, (item) => ({
							...item,
							id: String(item.episode),
						})),
					),
				};
		}
	}
	snapshot(id: string): MetadataSnapshot {
		const entry = this.storage(() => this.store.get(id));
		if (entry?.key.startsWith("project:")) {
			this.store.touch(id, Date.now());
			const document = entry.data as ProjectDocument;
			const states = document.sourceIds.flatMap((sourceId) =>
				this.store.get(sourceId) ? [this.source.snapshot(sourceId)] : [],
			);
			const failure = states.find((state) => state.refreshError)?.refreshError;
			return {
				...document.project,
				stale: document.project.stale || entry.expiresAt <= Date.now(),
				refreshing: states.some((state) => state.refreshing),
				refreshError: failure
					? { ...failure, message: "Metadata refresh failed. Retry shortly." }
					: document.project.refreshError,
			};
		}
		return this.project(this.source.snapshot(id));
	}
}
