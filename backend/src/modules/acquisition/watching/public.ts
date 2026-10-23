/** Consumer-owned projection: no provider credentials, repositories or pending commands. */
export interface WatchingSnapshot {
	accountId: string | null;
	generation: string;
	revision: string | null;
	complete: boolean;
	fresh: boolean;
	refreshAllowed: boolean;
	retryAt: number | null;
	entries: {
		workKey: string;
		title: string;
		status: string;
		progress: number;
	}[];
}
export interface WatchingListPort {
	snapshot(): WatchingSnapshot;
	refresh(): Promise<WatchingSnapshot>;
}
export interface WatchingConfig {
	backlog: "progress" | "beginning";
	profileId: string;
}
export interface WatchingPreview {
	id: string;
	expiresAt: number;
	revision: string;
	config: WatchingConfig;
	destination: string;
	providers: string[];
	works: {
		workKey: string;
		title: string;
		startEpisode: number | null;
		reason: string;
	}[];
}
export interface WatchingStatus {
	revision: string;
	enabled: boolean;
	reason: string;
	accountId: string | null;
	trackingGeneration: string;
	config: WatchingConfig | null;
	works: {
		workKey: string;
		title: string;
		revision: string | null;
		managed: boolean;
		excluded: boolean;
		paused: boolean;
		startEpisode: number | null;
		reason: string;
	}[];
}
export interface WatchingApi {
	status(): WatchingStatus;
	preview(
		sessionId: string,
		revision: string,
		config: WatchingConfig,
	): Promise<WatchingPreview>;
	confirm(sessionId: string, id: string): WatchingStatus;
	disable(revision: string): WatchingStatus;
	override(input: {
		accountId: string;
		trackingGeneration: string;
		workKey: string;
		revision: string | null;
		excluded: boolean;
		paused: boolean;
	}): WatchingStatus;
}
