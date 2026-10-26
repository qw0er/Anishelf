import type { MetadataSnapshot } from "./model.js";
import type { WorkDetails } from "./source-model.js";

export type ArtworkEvidence = Partial<Record<"cover" | "banner", WorkDetails>>;
export interface ProjectDocument {
	project: MetadataSnapshot;
	sourceIds: string[];
	artwork: ArtworkEvidence;
}
