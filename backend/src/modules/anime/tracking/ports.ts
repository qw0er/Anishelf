import type { TrackingConnection } from "./domain/model.js";
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
	read(
		accountId: number,
	): import("./domain/list.js").TrackingListCache | undefined;
	replace(cache: import("./domain/list.js").TrackingListCache): void;
}
export interface TrackingListAccess {
	status(): import("./domain/model.js").TrackingStatus;
	acquire(): Promise<import("./domain/list.js").TrackingLease>;
	assertCurrent(generation: string): void;
	authorizationFailed(generation: string): void;
}
