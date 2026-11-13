export interface ClientStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface OpenPlayerRequest {
	playerId: string;
	mediaUrl: string;
	mimeType: string;
}

export interface ClientPlatform {
	preferences: ClientStorage;
	sessionStorage: ClientStorage;
	preferredLanguages(): readonly string[];
	device: {
		userAgent: string;
		platform?: string;
		maxTouchPoints?: number;
		userAgentData?: { platform: string };
	};
	onPreferenceChange(key: string, callback: () => void): () => void;
	openExternal(url: string): void;
	openPlayer(request: OpenPlayerRequest): void;
	copyText(text: string): Promise<void>;
	downloadFile(url: string, filename: string): void;
	downloadText(content: string, filename: string, mediaType: string): void;
	isVisible(): boolean;
	isOnline(): boolean;
	onForegroundChange(callback: () => void): () => void;
	onPlaybackLifecycle(handlers: {
		onBackground: () => void;
		onOnline: () => void;
	}): () => void;
}
