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

export async function openExternal(value: unknown) {
	await shell.openExternal(httpUrl(value).href);
	console.info("desktop.external_link_opened");
}
