export interface TrackingAccount {
	id: number;
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
	clientId: string;
	authorizationUrl: string;
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
	token: string;
	account: TrackingAccount;
	expiresAt: number;
	generation: string;
}

export interface TrackingAuthorization {
	clientId: string;
	authorizationUrl: string;
}
