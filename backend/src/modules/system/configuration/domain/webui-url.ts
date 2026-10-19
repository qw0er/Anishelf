import { DomainError } from "../../../../shared/errors.js";

export function normalizeQbittorrentWebUiUrl(value: unknown): string | null {
	if (
		value === null ||
		value === undefined ||
		(typeof value === "string" && !value.trim())
	)
		return null;
	try {
		if (
			typeof value !== "string" ||
			value.length > 2048 ||
			[...value.trim()].some((character) => character.charCodeAt(0) <= 32) ||
			value.includes("\\")
		)
			throw new Error();
		const url = new URL(value.trim());
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password
		)
			throw new Error();
		return url.href;
	} catch {
		throw new DomainError(
			"CONFIG_INVALID",
			"WebUI URL must be an absolute HTTP(S) URL without credentials.",
		);
	}
}
