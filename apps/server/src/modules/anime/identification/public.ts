import type { IdentificationResult } from "@anishelf/anime-identification";
import type { SourceIdentity } from "../../resources/public.js";

export type { IdentificationMetadata } from "./ports.js";

/** Callers supply confined, validated identities and own scheduling/persistence. */
export interface IdentificationApi {
	readonly version: string;
	identify(
		sources: readonly SourceIdentity[],
		signal?: AbortSignal,
		options?: { refreshMetadata?: boolean },
	): Promise<IdentificationResult[]>;
}
