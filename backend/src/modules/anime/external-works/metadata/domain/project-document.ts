import type { MetadataSnapshot } from "./model.js";
import type { WorkDetails } from "./source-model.js";

export type ArtworkEvidence = Partial<Record<"cover" | "banner", WorkDetails>>;
export interface NameEvidence {
	originSnapshotId: string;
	peerSnapshotId: string;
	peer: WorkDetails["reference"];
}
export interface ProjectDocument {
	/** Durable proof only applies while both source detail snapshots remain unchanged. */
	nameEvidence?: NameEvidence;
	project: MetadataSnapshot;
	sourceIds: string[];
	artwork: ArtworkEvidence;
}
