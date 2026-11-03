import {
	MetadataError,
	type ReadOptions,
	type WorkReference,
} from "../domain/model.js";
import type { SourceMetadataApi } from "../ports.js";
import type { MetadataIdentities } from "./identities.js";
import { readMetadata } from "./operations.js";
import type { MetadataSnapshots } from "./snapshots.js";
import type { MetadataWorkReader } from "./work-reader.js";

export class MetadataArtworkReader {
	constructor(
		private readonly source: Pick<
			SourceMetadataApi,
			"artworkEvidence" | "snapshotArtwork" | "cachedArtworkId"
		>,
		private readonly identities: Pick<MetadataIdentities, "references">,
		private readonly snapshots: Pick<MetadataSnapshots, "document">,
		private readonly works: Pick<MetadataWorkReader, "get">,
	) {}
	async artwork(
		reference: WorkReference,
		kind: "cover" | "banner",
		options: ReadOptions = {},
	) {
		const details = await this.works.get(reference, options);
		return this.snapshotArtwork(details.snapshotId, kind, options);
	}
	async snapshotArtwork(
		id: string,
		kind: "cover" | "banner",
		options: ReadOptions = {},
	) {
		if (kind !== "cover" && kind !== "banner")
			throw new MetadataError({
				code: "invalid-request",
				message: "Unknown artwork kind.",
				retryAt: null,
			});
		const document = this.snapshots.document(id);
		if (document) {
			if (document.project.kind !== "detail")
				throw new MetadataError({
					code: "invalid-request",
					message: "Artwork requires a detail snapshot.",
					retryAt: null,
				});
			const data = document.artwork[kind];
			return data
				? this.source.artworkEvidence(data, kind, options)
				: { id: null, status: "missing" as const, failure: null };
		}
		return readMetadata(() => this.source.snapshotArtwork(id, kind));
	}
	async cachedArtworkId(reference: WorkReference, kind: "cover" | "banner") {
		for (const ref of this.identities.references(reference)) {
			const id = await this.source.cachedArtworkId(ref, kind);
			if (id) return id;
		}
		return null;
	}
}
