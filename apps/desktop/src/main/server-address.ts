const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseServerOrigin(target: unknown): string | null {
	if (typeof target !== "string") return null;
	const address = target.trim();
	if (!/^https?:\/\/[^\s/@?#\\]+\/?$/i.test(address)) return null;
	const url = URL.parse(address);
	if (
		!url ||
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.href !== `${url.origin}/`
	) {
		return null;
	}
	if (url.protocol === "http:" && !loopbackHosts.has(url.hostname)) {
		return null;
	}
	return url.origin;
}
