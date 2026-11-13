import { shell } from "electron";
import { desktopScheme } from "../renderer-url.js";

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

const unsafePlayerSchemes = new Set([
	"about:",
	"blob:",
	"chrome:",
	"chrome-extension:",
	"data:",
	"devtools:",
	"edge:",
	"file:",
	"filesystem:",
	"http:",
	"https:",
	"javascript:",
	"vbscript:",
	`${desktopScheme}:`,
]);

export function openExternal(url: unknown) {
	return shell.openExternal(httpUrl(url).href);
}

export function openPlayer(value: unknown) {
	const url = typeof value === "string" ? URL.parse(value) : null;
	if (
		!url ||
		unsafePlayerSchemes.has(url.protocol) ||
		url.username ||
		url.password
	)
		throw new Error("Unsupported external player URL.");
	return shell.openExternal(url.href);
}
