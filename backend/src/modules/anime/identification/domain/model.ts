import type { SourceIdentity } from "../../../resources/public.js";

interface ProviderReference {
	provider: string;
	mediaType: "anime";
	id: string;
}
/** Consumer-owned metadata projection, independent of provider transport types. */
export interface WorkCandidate {
	reference: ProviderReference;
	snapshotId: string;
	titles: string[];
	titleVariants?: {
		value: string;
		kind: "primary" | "alias";
		language: string | null;
	}[];
	year: number | null;
	format: string | null;
	episodeCount: number | null;
	/** Series ordinal; never the provider's calendar airing season. */
	season: string | null;
	part: string | null;
	ordinalSource?: "provider-title";
}
export interface RankedCandidate {
	work: WorkCandidate;
	score: number;
	reasons: string[];
	conflicts: string[];
	identityConflicts?: string[];
	identityUnresolved?: string[];
	assumptions?: string[];
	matcherVersion: string;
}
export interface ExtractionElement {
	kind: string;
	value: string;
	position: number;
}
export interface ExtractionInput {
	mode: "basename" | "ancestor" | "path" | "together";
	input: string;
	elements: ExtractionElement[];
}
export interface ExtractionEvidence {
	parser: string;
	parserVersion: string;
	normalizationVersion: string;
	contextFingerprint: string;
	originalName: string;
	relativePath: string;
	inputs: ExtractionInput[];
	titles: string[];
	titleSources?: {
		title: string;
		mode: ExtractionInput["mode"];
		distance: number;
	}[];
	years: string[];
	seasons: string[];
	parts: string[];
	rawEpisodes: string[];
	/** Explicitly selected leaf numbers; raw release tokens remain available. */
	selectedEpisodes?: string[];
	/** Interpret only leaf numbering; ancestor batch ranges are context. */
	numbering: "single" | "range" | "ambiguous" | "unknown";
	contentKind: "regular" | "special" | "ancillary" | "unknown";
}
interface EpisodeTarget {
	kind: "regular" | "special" | "movie";
	number: string;
}
export interface MappingProposal {
	targets: EpisodeTarget[];
	reasons: string[];
	unresolved: string[];
	numbering?: {
		source: "directory-anchors";
		offset: number;
		anchors: { fileId: string; sourceVersion: string }[];
	};
}
/** One possible interpretation, never a committed association. */
interface WorkProposal {
	candidate: RankedCandidate;
	mapping: MappingProposal;
}
export interface IdentificationResult {
	source: SourceIdentity;
	evidence: ExtractionEvidence;
	status: "parsed" | "proposed" | "unresolved";
	metadataStatus: "not-configured" | "searched" | "failed";
	proposals: WorkProposal[];
	unresolved: string[];
}
