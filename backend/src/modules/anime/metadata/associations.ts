import type { ExternalWorkReference } from "../../../shared/external-reference.js";
import type { WorkReference } from "./public.js";

/** Explicit external-system identity bridge. Not part of ordinary content reads. */
export interface MetadataAssociations {
	referenceForExternal(reference: ExternalWorkReference): WorkReference;
	externalReference(
		reference: WorkReference,
		provider?: string,
	): ExternalWorkReference | null;
}

/** Explicit management capability, never required by ordinary content consumers. */
export interface MetadataManagement {
	associate(
		target: WorkReference,
		other: WorkReference,
		confirmation: { sameEpisodeNumbering: true },
	): WorkReference;
}
