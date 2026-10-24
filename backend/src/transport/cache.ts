import type { FastifyReply, FastifyRequest } from "fastify";

/** Strong validator wrapped in the quotes HTTP requires. */
function entityTag(id: string): string {
	return `"${id}"`;
}

/** `If-None-Match` is a list of quoted tags, optionally weak or `*`. */
function matchesEntityTag(header: string | undefined, etag: string): boolean {
	if (!header) return false;
	return header.split(",").some((entry) => {
		const candidate = entry.trim();
		return candidate === "*" || candidate.replace(/^W\//, "") === etag;
	});
}

/**
 * Delivers a binary asset that is safe to store in the browser cache.
 *
 * Assets are addressed by content, so callers pass their content identity as the
 * strong validator: an unchanged asset answers `304 Not Modified` without the
 * body, while a new identity gets a new URL and never reuses a stale entry.
 * `private` keeps the authorized asset out of shared proxies; authentication is
 * still enforced on every request before the response is produced.
 */
export function sendCachedAsset(
	request: Pick<FastifyRequest, "headers">,
	reply: FastifyReply,
	asset: { id: string; mimeType: string; bytes: Uint8Array },
	options: { maxAgeSeconds: number },
) {
	const etag = entityTag(asset.id);
	reply
		.header("Cache-Control", `private, max-age=${options.maxAgeSeconds}`)
		.header("ETag", etag)
		.header("X-Content-Type-Options", "nosniff");
	if (matchesEntityTag(request.headers["if-none-match"], etag))
		return reply.code(304).send();
	return reply.type(asset.mimeType).send(Buffer.from(asset.bytes));
}
