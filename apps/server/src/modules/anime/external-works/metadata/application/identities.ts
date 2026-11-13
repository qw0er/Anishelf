import type { Logger } from "pino";
import type { ExternalWorkReference } from "../../../../../shared/external-reference.js";
import { workReference } from "../../../../../shared/external-reference.js";
import { MetadataError, type WorkReference } from "../domain/model.js";
import type { MetadataIdentitiesApi } from "../identities.js";
import type { MetadataStore, SourceMetadataApi } from "../ports.js";
import { metadataStorage } from "./operations.js";

export class MetadataIdentities implements MetadataIdentitiesApi {
	constructor(
		private readonly source: Pick<SourceMetadataApi, "resolveReference">,
		private readonly store: Pick<
			MetadataStore,
			"identify" | "identity" | "references"
		>,
		private readonly logger?: Logger,
	) {}
	private storage<T>(operation: () => T): T {
		return metadataStorage(operation, this.logger);
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
		if (refs.length !== 1)
			throw new MetadataError({
				code: "not-found",
				message: "Metadata work was not found.",
				retryAt: null,
			});
		return refs;
	}
}
