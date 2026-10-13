export type ClientPlatform =
	| "macos"
	| "linux"
	| "windows"
	| "android"
	| "ios"
	| "unknown";
export interface ExternalPlayerPreset {
	readonly id: string;
	readonly name: string;
	readonly platforms: readonly ClientPlatform[];
	readonly template: string;
}

/** Browser handoff compatibility; this does not detect installed applications. */
export const externalPlayerPolicy = {
	storageKey: "anishelf.external-players.v1",
	maximumCustomPlayers: 30,
	maximumNameLength: 80,
	maximumTemplateLength: 2048,
	blockedSchemes: [
		"http",
		"https",
		"javascript",
		"vbscript",
		"data",
		"blob",
		"file",
		"about",
		"chrome",
		"edge",
	],
	presets: [
		{
			id: "iina",
			name: "IINA",
			platforms: ["macos"],
			template: "iina://open?url={urlEncoded}",
		},
		{
			id: "infuse",
			name: "Infuse",
			platforms: ["macos", "ios"],
			template: "infuse://x-callback-url/play?url={urlEncoded}",
		},
		{
			id: "mpv",
			name: "mpv",
			platforms: ["macos", "linux", "windows"],
			template: "mpv://{url}",
		},
		{
			id: "vlc-android",
			name: "VLC",
			platforms: ["android"],
			template:
				"intent:{url}#Intent;action=android.intent.action.VIEW;package=org.videolan.vlc;type={mimeType};end",
		},
		{
			id: "mx-player",
			name: "MX Player",
			platforms: ["android"],
			template:
				"intent:{url}#Intent;action=android.intent.action.VIEW;package=com.mxtech.videoplayer.ad;type={mimeType};end",
		},
		{
			id: "mpv-android",
			name: "mpv-android",
			platforms: ["android"],
			template:
				"intent:{url}#Intent;action=android.intent.action.VIEW;package=is.xyz.mpv;type={mimeType};end",
		},
		{
			id: "vlc-ios",
			name: "VLC",
			platforms: ["ios"],
			template: "vlc-x-callback://x-callback-url/stream?url={urlEncoded}",
		},
		{
			id: "outplayer",
			name: "Outplayer",
			platforms: ["ios"],
			template: "outplayer://{url}",
		},
	] as const satisfies readonly ExternalPlayerPreset[],
};

export function detectClientPlatform(client: {
	userAgent: string;
	platform?: string;
	maxTouchPoints?: number;
	userAgentData?: { platform: string };
}): ClientPlatform {
	const hints = `${client.userAgentData?.platform ?? ""} ${client.platform ?? ""}`;
	const ua = client.userAgent;
	if (/Android/i.test(`${hints} ${ua}`)) return "android";
	if (
		/iPhone|iPad|iPod/i.test(ua) ||
		(/Mac/i.test(hints) && (client.maxTouchPoints ?? 0) > 1)
	)
		return "ios";
	if (/Windows|Win32|Win64/i.test(`${hints} ${ua}`)) return "windows";
	if (/Mac/i.test(`${hints} ${ua}`)) return "macos";
	if (/Linux|X11/i.test(`${hints} ${ua}`)) return "linux";
	return "unknown";
}

export function presetsForPlatform(
	platform: ClientPlatform,
): readonly ExternalPlayerPreset[] {
	return externalPlayerPolicy.presets.filter((preset: ExternalPlayerPreset) =>
		preset.platforms.includes(platform),
	);
}
