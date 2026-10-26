import type { Logger } from "pino";
import type { ExternalWorkReference } from "../../../../shared/external-reference.js";
import { workReference } from "../../../../shared/external-reference.js";
import type {
	MetadataAssociations,
	MetadataManagement,
} from "../associations.js";
import { MetadataError, type WorkReference } from "../domain/model.js";
import type { MetadataStore, SourceMetadataApi } from "../ports.js";
import { metadataStorage } from "./operations.js";

export class MetadataIdentities
	implements MetadataAssociations, MetadataManagement
{
	constructor(
		private readonly source: Pick<SourceMetadataApi, "resolveReference">,
		private readonly store: Pick<
			MetadataStore,
			"identify" | "originalIdentity" | "identity" | "references" | "merge"
		>,
		private readonly logger?: Logger,
		private readonly canAssociate?: (
			target: WorkReference,
			other: WorkReference,
		) => boolean,
	) {}
	private storage<T>(operation: () => T): T {
		return metadataStorage(operation, this.logger);
	}
	originalReference(reference: ExternalWorkReference): WorkReference {
		return { id: this.storage(() => this.store.originalIdentity(reference)) };
	}
	referenceForExternal(reference: ExternalWorkReference): WorkReference {
		const id = this.storage(() => this.store.identify(reference));
		this.logger?.trace(
			{ event: "metadata.work_identity_resolved", workId: id },
			"Project metadata identity resolved.",
		);
		return { id };
	}
	/** Explicit external-system bridge, separate from the public content API. */
	externalReference(
		reference: WorkReference,
		provider?: string,
	): ExternalWorkReference | null {
		const refs = this.references(reference);
		return (
			(provider ? refs.find((ref) => ref.provider === provider) : refs[0]) ??
			null
		);
	}
	resolveReference(value: string): WorkReference {
		let external: ExternalWorkReference | null = null;
		try {
			external = workReference(value);
		} catch {}
		if (external)
			return this.referenceForExternal(
				this.source.resolveReference(external.id, external.provider),
			);
		const existing = this.storage(() => this.store.identity(value));
		return existing
			? { id: existing }
			: this.referenceForExternal(this.source.resolveReference(value));
	}
	references(reference: WorkReference) {
		const refs = this.storage(() => this.store.references(reference.id));
		if (!refs[0])
			throw new MetadataError({
				code: "not-found",
				message: "Metadata work was not found.",
				retryAt: null,
			});
		return refs;
	}
	/** Explicit management operation; ordinary consumers never select a source. */
	associate(
		target: WorkReference,
		other: WorkReference,
		confirmation: { sameEpisodeNumbering: true },
	): WorkReference {
		if (confirmation.sameEpisodeNumbering !== true)
			throw new MetadataError({
				code: "invalid-request",
				message:
					"Confirm matching works and equivalent episode numbering before association.",
				retryAt: null,
			});
		const left = this.references(target),
			right = this.references(other);
		const id = this.storage(() => this.store.identity(target.id)),
			otherId = this.storage(() => this.store.identity(other.id));
		if (id === otherId) return { id: id as string };
		if (left.some((a) => right.some((b) => a.provider === b.provider)))
			throw new MetadataError({
				code: "invalid-request",
				message: "These works have conflicting source associations.",
				retryAt: null,
			});
		if (
			this.canAssociate &&
			!this.storage(() => this.canAssociate?.(target, other))
		)
			throw new MetadataError({
				code: "invalid-request",
				message:
					"Resolve duplicate local Catalog works before associating metadata.",
				retryAt: null,
			});
		this.storage(() => this.store.merge(target.id, other.id));
		this.logger?.info(
			{ event: "metadata.works_associated", workId: id, aliasId: otherId },
			"Verified metadata works associated; existing IDs remain resolvable.",
		);
		return { id: id as string };
	}
}
