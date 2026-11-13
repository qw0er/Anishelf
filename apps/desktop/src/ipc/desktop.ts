export interface DesktopBridge {
	getServerOrigin(): Promise<string>;
	signIn(password: string): Promise<{ status: number }>;
	clearDeviceToken(): Promise<void>;
}
