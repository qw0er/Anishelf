import type { SourceIdentity } from "../../../resources/public.js";

export interface DownloadDestination {
	revision: string;
	scopeId: string;
	path: string;
	connectionGeneration: string;
	validated: boolean;
	visibilityVerified: boolean;
}
export interface OneOffAuthorization {
	/** Retain the publication across explicit retries until its remote binding is confirmed. */
	uncertainSubmission?: boolean;
	/** Changed settings cannot authorize a new add while an older submission is uncertain. */
	reconcileOnly?: boolean;
	profileId: string;
	profileFingerprint: string;
	sourceGeneration: string;
	discovery: { providerId: string; code: string | null; limited: boolean }[];
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
	origin: "subscription" | "one-off";
	oneOff: OneOffAuthorization | null;
	subscriptionRevision: string | null;
	state:
		| "discovering"
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
export interface DownloadActivity {
	planningError?: string | null;
	authorized: boolean;
	destination: string | null;
	items: (Omit<
		DownloadIntent,
		| "oneOff"
		| "source"
		| "destination"
		| "directory"
		| "subscriptionRevision"
		| "sourceIdentity"
		| "lastCommand"
		| "hash"
		| "expectedHash"
	> & { canRetryAcquisition: boolean })[];
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
