export interface ConnectionInput {
	generation: string;
	url: string;
	username: string;
	password?: string;
}
export interface ConnectionSettings {
	generation: string;
	state: "unconfigured" | "configured" | "unavailable";
	url: string | null;
	username: string;
	passwordConfigured: boolean;
}
export interface ConnectionProbe {
	generation: string;
	available: boolean;
	checkedAt: number;
	version: string | null;
	code: string | null;
}
export interface SavedConnection {
	version: 1;
	generation: string;
	connection: { url: string; username: string; password: string } | null;
}
