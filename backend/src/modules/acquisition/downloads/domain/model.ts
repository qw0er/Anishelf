import type { SourceIdentity } from "../../../resources/public.js";

export interface DownloadDestination {
	revision: string;
	scopeId: string;
	path: string;
	connectionGeneration: string;
	validated: boolean;
	visibilityVerified: boolean;
}
export interface DownloadIntent {
	id: string;
	revision: string;
	workKey: string;
	candidateId: string;
	episode: number;
	title: string;
	hash: string;
	expectedHash: string | null;
	/** Opaque Sources download reference; never a URL or adapter descriptor. */
	source: string;
	destination: DownloadDestination;
	directory: string;
	subscriptionRevision: string;
	state:
		| "pending"
		| "submitting"
		| "unknown"
		| "bound"
		| "blocked"
		| "missing"
		| "available";
	transfer: string | null;
	progress: number | null;
	ingestion:
		| "not-ready"
		| "pending"
		| "validating"
		| "review"
		| "failed"
		| "available";
	error: string | null;
	attempts: number;
	nextAttemptAt: number;
	observedAt: number | null;
	updatedAt: number;
	createdAt: number;
	sourceIdentity: SourceIdentity | null;
	lastCommand: { id: string; kind: "acquisition" | "import" } | null;
}
export interface DownloadAuthorization {
	workKey: string;
	feedId: string;
	startEpisode: number;
	destinationRevision: string;
	connectionGeneration: string;
}
export interface DownloadActivity {
	authorized: boolean;
	destination: string | null;
	items: Omit<
		DownloadIntent,
		| "source"
		| "destination"
		| "directory"
		| "subscriptionRevision"
		| "sourceIdentity"
		| "lastCommand"
		| "hash"
		| "expectedHash"
	>[];
	total: number;
	active: number;
	attention: number;
	managedCandidateIds: string[];
	page: number;
}
export class DownloadError extends Error {
	constructor(readonly code: string) {
		super("Acquisition operation could not complete.");
	}
}
