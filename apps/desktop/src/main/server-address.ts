import { serverDefaults } from "@anishelf/contracts/defaults";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function resolveServerOrigin(
	target = process.env.ANISHELF_API_TARGET,
): string {
	const url = URL.parse(
		target ?? `http://${serverDefaults.host}:${serverDefaults.port}`,
	);
	if (
		!url ||
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.href !== `${url.origin}/`
	) {
		throw new Error("ANISHELF_API_TARGET must be an HTTP(S) server origin.");
	}
	if (url.protocol === "http:" && !loopbackHosts.has(url.hostname)) {
		throw new Error("ANISHELF_API_TARGET must use HTTPS for a remote server.");
	}
	return url.origin;
}
