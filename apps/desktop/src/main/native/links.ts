import { shell } from "electron";

export function httpUrl(value: unknown): URL {
	const url = typeof value === "string" ? URL.parse(value) : null;
	if (
		!url ||
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password
	)
		throw new Error("Expected an HTTP(S) URL without credentials.");
	return url;
}

const playerSchemes = new Set([
	"iina:",
	"infuse:",
	"mpv:",
	"vlc:",
	"potplayer:",
]);

export async function openExternal(value: unknown) {
	await shell.openExternal(httpUrl(value).href);
	console.info("desktop.external_link_opened");
}

export async function openPlayer(value: unknown) {
	const url = typeof value === "string" ? URL.parse(value) : null;
	if (!url || !playerSchemes.has(url.protocol) || url.username || url.password)
		throw new Error("Unsupported desktop player URL.");
	await shell.openExternal(url.href);
	console.info("desktop.external_player_opened", { scheme: url.protocol });
}
