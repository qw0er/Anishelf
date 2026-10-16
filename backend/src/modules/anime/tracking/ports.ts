import type {
	TrackingLease,
	TrackingListCache,
	TrackingListEntry,
} from "./domain/list.js";
import type {
	TrackingAccount,
	TrackingConnection,
	TrackingStatus,
} from "./domain/model.js";
import type {
	TrackingDesiredState,
	TrackingOperation,
	TrackingRemoteState,
} from "./domain/operation.js";
export interface TrackingOperationStore {
	list(accountId: number): TrackingOperation[];
	save(operation: TrackingOperation): void;
	remove(id: string): void;
	manualVersion(accountId: number, mediaId: number): number;
	command(
		accountId: number,
		commandId: string,
	): { operationId: string; revision: number } | undefined;
	admit(operation: TrackingOperation): void;
}
export interface TrackingUpdateProvider {
	get(
		lease: TrackingLease,
		mediaId: number,
		signal: AbortSignal,
	): Promise<TrackingRemoteState | null>;
	save(
		lease: TrackingLease,
		mediaId: number,
		entryId: number | null,
		desired: TrackingDesiredState,
		signal: AbortSignal,
	): Promise<TrackingRemoteState>;
}
export interface TrackingStore {
	get(): TrackingConnection | undefined;
	save(connection: TrackingConnection): void;
}
export interface TrackingCredentials {
	read(connection: TrackingConnection): Promise<string>;
	write(connection: TrackingConnection, token: string): Promise<void>;
	remove(id: string): Promise<void>;
}
export interface TrackingListStore {
	read(accountId: number): TrackingListCache | undefined;
	replace(cache: TrackingListCache): void;
}
export interface TrackingListAccess {
	status(): TrackingStatus;
	acquire(): Promise<TrackingLease>;
	assertCurrent(generation: string): void;
	authorizationFailed(generation: string): void;
}
export interface TrackingAccountProvider {
	viewer(token: string, signal: AbortSignal): Promise<TrackingAccount>;
}
export interface TrackingListProvider {
	read(lease: TrackingLease, signal: AbortSignal): Promise<TrackingListEntry[]>;
}
