export interface DesktopBridge {
	getServerOrigin(): Promise<string>;
	signIn(password: string): Promise<{ status: number }>;
	clearDeviceToken(): Promise<void>;
	copyText(text: string): Promise<void>;
	openExternal(url: string): Promise<void>;
	openPlayer(url: string): Promise<void>;
	downloadFile(url: string, filename: string): Promise<void>;
}
