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
