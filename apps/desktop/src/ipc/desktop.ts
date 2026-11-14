export interface CommandPlayerDraft {
	name: string;
	executable: string;
	args: string[];
}

export interface CommandPlayerConfig extends CommandPlayerDraft {
	id: string;
}

export interface CommandPlayerPreset extends CommandPlayerDraft {
	id: string;
}

export interface ExternalPlayerListResponse {
	presets: CommandPlayerPreset[];
	players: CommandPlayerConfig[];
	error: boolean;
}

export type ServerSignInResult =
	| { status: "ok"; origin: string }
	| { status: "rejected"; httpStatus: number }
	| {
			status:
				| "invalidAddress"
				| "invalidResponse"
				| "unreachable"
				| "saveFailed"
				| "busy";
	  };

export interface DesktopUpdateCheck {
	status:
		| "available"
		| "current"
		| "ahead"
		| "uncomparable"
		| "no-release"
		| "no-package";
	checkedAt: string;
	latest: { version: string; url: string } | null;
	downloads?: readonly { name: string; url: string }[];
}

export interface DesktopBridge {
	checkForUpdates(): Promise<DesktopUpdateCheck>;
	getServerOrigin(): Promise<string>;
	signIn(origin: string, password: string): Promise<ServerSignInResult>;
	clearDeviceToken(origin: string): Promise<void>;
	copyText(text: string): Promise<void>;
	openExternal(url: string): Promise<void>;
	downloadFile(url: string, filename: string): Promise<void>;
	listExternalPlayers(): Promise<ExternalPlayerListResponse>;
	addExternalPlayer(draft: CommandPlayerDraft): Promise<void>;
	removeExternalPlayer(id: string): Promise<void>;
	choosePlayerExecutable(): Promise<string | null>;
	launchExternalPlayer(
		id: string,
		mediaUrl: string,
		mimeType: string,
	): Promise<void>;
}
