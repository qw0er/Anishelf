import type { TrackingListSnapshot } from "./domain/list.js";
import type { TrackingPreview, TrackingStatus } from "./domain/model.js";
import type {
	TrackingOperation,
	TrackingOperationCommand,
	TrackingUpdate,
} from "./domain/operation.js";

export type {
	TrackingListEntry,
	TrackingListSnapshot,
	ViewingStatus,
} from "./domain/list.js";
export interface TrackingAccountsApi {
	status(): TrackingStatus;
	preview(sessionId: string, credential: string): Promise<TrackingPreview>;
	confirm(
		sessionId: string,
		candidateId: string,
		generation: string,
	): Promise<TrackingStatus>;
	disconnect(generation: string): Promise<TrackingStatus>;
	check(): Promise<TrackingStatus>;
}

export interface TrackingListsApi {
	list(generation?: string, refreshStale?: boolean): TrackingListSnapshot;
	refreshList(generation?: string): Promise<TrackingListSnapshot>;
}

/** Durable manual viewing-state commands, isolated by account and connection. */
export interface TrackingUpdatesApi {
	operations(generation: string): TrackingOperation[];
	replayCommand(
		commandId: string,
		generation: string,
	): TrackingOperation | undefined;
	manualVersion(mediaId: string, generation: string): number;
	update(mediaId: string, input: TrackingUpdate): TrackingOperation;
	retryOperation(
		id: string,
		input: TrackingOperationCommand,
	): TrackingOperation;
	resolveOperation(
		id: string,
		input: TrackingOperationCommand,
		keepRemote: boolean,
	): Promise<TrackingOperation>;
}
export interface TrackingApi
	extends TrackingAccountsApi,
		TrackingListsApi,
		TrackingUpdatesApi {}

export interface TrackingEpisodeCommand {
	mappingRevision: number;
	commandId: string;
	generation: string;
	revision: number | null;
	fileId: string;
	sourceVersion: string;
	action: "mark" | "keep";
	confirmSkipped?: boolean;
	initialStatus?: import("./domain/list.js").ViewingStatus;
}
export interface TrackingObservationOutcome {
	state: "pending" | "accepted" | "ignored" | "unavailable";
	reason: string;
	operationId?: string;
	revision?: number;
}
export type TrackingEpisodeResolution =
	| {
			state: "resolved";
			target: import("./domain/operation.js").TrackingEpisodeTarget;
	  }
	| {
			state: "unmapped" | "ambiguous" | "unsupported" | "unavailable";
			target: null;
	  };
export interface TrackingViewingApi {
	resolveTarget(
		fileId: string,
		sourceVersion: string,
	): Promise<TrackingEpisodeResolution>;
	target(
		fileId: string,
		sourceVersion: string,
	): Promise<import("./domain/operation.js").TrackingEpisodeTarget | null>;
	mark(input: TrackingEpisodeCommand): Promise<TrackingOperation>;
}
