export interface DesktopBridge {
	configuration(): Promise<{ origin: string; deviceName: string }>;
	setDeviceToken(token: string | null): Promise<void>;
	copyText(text: string): Promise<void>;
	openExternal(url: string): Promise<void>;
	openPlayer(url: string): Promise<void>;
	downloadFile(url: string, filename: string): Promise<void>;
}
