export type {
	ExtractionEvidence,
	IdentificationResult,
	WorkCandidate,
} from "./domain/model.js";
export { matchingTitle, titleEvidence } from "./domain/title-evidence.js";
export type { IdentificationMetadata } from "./ports.js";

import type { SourceIdentity } from "../../resources/public.js";
import type { IdentificationResult } from "./domain/model.js";

/** Callers supply confined, validated identities and own scheduling/persistence. */
export interface IdentificationApi {
	readonly version: string;
	identify(
		sources: readonly SourceIdentity[],
		signal?: AbortSignal,
	): Promise<IdentificationResult[]>;
}
