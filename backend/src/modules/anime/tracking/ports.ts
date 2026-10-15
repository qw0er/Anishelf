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
