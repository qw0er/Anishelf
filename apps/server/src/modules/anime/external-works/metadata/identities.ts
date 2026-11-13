import type { ExternalWorkReference } from "../../../../shared/external-reference.js";
import type { WorkReference } from "./public.js";
/** One source entry per project identity. Shared inside External Works. */
export interface MetadataIdentitiesApi {
	referenceForExternal(reference: ExternalWorkReference): WorkReference;
	externalReference(
		reference: WorkReference,
		provider?: string,
	): ExternalWorkReference | null;
}
