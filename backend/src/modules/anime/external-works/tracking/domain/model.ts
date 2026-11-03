import type { ViewingStatus } from "./viewing.js";
export interface TrackingAccount {
	id: string;
	name: string;
}
export interface TrackingConnection {
	generation: string;
	account: TrackingAccount | null;
	credentialId: string | null;
	state: "disconnected" | "connected" | "authorization-required";
	checkedAt: number | null;
}
export interface TrackingStatus {
	provider: TrackingProviderDescriptor;
	generation: string;
	account: TrackingAccount | null;
	state: TrackingConnection["state"];
	connectivity: "unknown" | "available" | "unavailable";
	checkedAt: number | null;
}
export interface TrackingPreview {
	candidateId: string;
	account: TrackingAccount;
	expiresAt: number;
	generation: string;
}

/** Server-only authorization candidate, never part of an HTTP response. */
export interface TrackingCandidate {
	id: string;
	credential: string;
	account: TrackingAccount;
	expiresAt: number;
	generation: string;
}

export interface TrackingAuthorization {
	provider: TrackingProviderDescriptor;
}

export interface TrackingProviderDescriptor {
	key: string;
	name: string;
	authorization: { kind: "credential"; label: string; url: string | null };
	capabilities: {
		progress: "cumulative-episodes";
		maximumProgress: number;
		statuses: ViewingStatus[];
	};
}
