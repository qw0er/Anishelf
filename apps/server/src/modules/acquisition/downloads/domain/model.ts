import type { AcquisitionReview } from "../../../anime/public.js";
import type {
	FileSourceIdentity,
	SourceIdentity,
} from "../../../resources/public.js";
import type { TorrentManifest } from "../../torrent-clients/public.js";

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
	acceptedTarget?:
		| import("../../../anime/public.js").AcceptedAcquisitionTarget
		| null;
	id: string;
	transferId?: string;
	/** Durable downloader ownership read from the managed transfer. */
	ownerKey?: string;
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
	associationReview?: AcquisitionReview | null;
	lastCommand: { id: string; kind: "acquisition" | "import" } | null;
}
export interface DownloadFileObservation {
	index: number | null;
	path: string;
	sizeBytes: number;
	selected: boolean;
	priority?: number;
}
export interface EpisodeFilePlan {
	manifest: TorrentManifest;
	videoIndex: number;
	subtitleIndices: readonly number[];
}
export interface FileSelectionReservation {
	item: DownloadIntent;
	plan: EpisodeFilePlan;
	expectedRevision: string;
}

export interface PlannedDownloadFile {
	index: number;
	path: string;
	role: "video" | "subtitle";
	progress: number | null;
}

export interface PendingFileSelection {
	requestId: string;
	additionalRequestIds?: readonly string[];
	kind: "add" | "expand";
	added: readonly number[];
	sentAt: number | null;
}

export interface ManagedFileSelection {
	id: string;
	hash: string;
	ownerKey: string;
	workKey: string;
	destination: DownloadDestination;
	directory: string;
	owned: boolean;
	revision: string;
	manifest: TorrentManifest;
	pending: PendingFileSelection | null;
	observed: readonly DownloadFileObservation[] | null;
}
export interface VerifiedDownloadFiles {
	video: DownloadFileObservation;
	selection: readonly DownloadFileObservation[];
	sidecars?: readonly {
		index: number;
		identity: FileSourceIdentity;
	}[];
}

export function isCanonicalDownloadHash(hash: string): boolean {
	return /^[0-9a-f]{40}$/.test(hash);
}

export function keepsEpisodeClaim(
	item: Pick<DownloadIntent, "state" | "error" | "hash">,
) {
	if (item.state === "available" || item.state === "missing") return false;
	return (
		item.state !== "blocked" ||
		(item.error === "downloader_configuration_changed" &&
			isCanonicalDownloadHash(item.hash))
	);
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
		| "ownerKey"
		| "transferId"
		| "associationReview"
	> & {
		canRetryAcquisition: boolean;
		sharedTransfer?: boolean;
		selectedFiles?: Omit<PlannedDownloadFile, "index">[];
		reviewId?: string;
	})[];
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
