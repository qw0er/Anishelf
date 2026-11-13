import { MediaAccessLinkResponseSchema } from "@anishelf/contracts/schemas/authentication";
import { ResourceParamsSchema } from "@anishelf/contracts/schemas/common";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { AuthenticationService } from "../application.js";
import type { AuthenticationStore } from "../ports.js";
import { createToken, digest, opaqueTokenPattern } from "../tokens.js";

const linkLifetime = 24 * 60 * 60 * 1000;
export interface MediaLinkSources {
	version(id: string): Promise<string>;
}

export function createMediaLinks(
	service: AuthenticationService,
	store: AuthenticationStore,
	sources: MediaLinkSources,
	logger: Logger,
) {
	async function permits(method: string, url: URL) {
		const fileId = /^\/api\/media\/([A-Za-z0-9_-]+)$/.exec(url.pathname)?.[1];
		if (!fileId) {
			if (url.pathname.startsWith("/api/media/"))
				logger.debug(
					{
						event: "auth.media_link_rejected",
						reason: "path",
						path: url.pathname,
						hasToken: url.searchParams.has("access_token"),
					},
					"Media access link rejected.",
				);
			return false;
		}
		const reject = (reason: string) => {
			logger.debug(
				{
					event: "auth.media_link_rejected",
					reason,
					fileId,
					path: url.pathname,
					hasToken: url.searchParams.has("access_token"),
				},
				"Media access link rejected.",
			);
			return false;
		};
		if (method !== "GET" && method !== "HEAD") return reject("method");
		const token = url.searchParams.get("access_token");
		if (!token || !opaqueTokenPattern.test(token)) return reject("token");
		const link = store.readLink(digest(token), Date.now());
		if (!link) return reject("link_missing");
		if (link.fileId !== fileId) return reject("file_mismatch");
		if (link.fingerprint !== service.fingerprint) return reject("fingerprint");
		let sourceVersion: string;
		try {
			sourceVersion = await sources.version(fileId);
		} catch {
			return reject("source_unavailable");
		}
		if (link.sourceVersion !== sourceVersion) return reject("source_version");
		return true;
	}
	return { permits, registerRoute };

	function registerRoute(app: HttpInstance) {
		app.post(
			"/api/media/:id/access-link",
			{
				schema: {
					params: ResourceParamsSchema,
					response: { 200: MediaAccessLinkResponseSchema },
				},
			},
			async function issueMediaLink(request) {
				const expected = service.fingerprint;
				const sourceVersion = await sources.version(request.params.id);
				if (expected !== service.fingerprint)
					throw new DomainError("AUTH_REQUIRED", "Sign in again.");
				const token = createToken();
				const expiresAt = Date.now() + linkLifetime;
				store.saveLink({
					tokenHash: digest(token),
					fileId: request.params.id,
					sourceVersion,
					fingerprint: service.fingerprint,
					expiresAt,
				});
				return {
					url: `/api/media/${encodeURIComponent(request.params.id)}?access_token=${token}`,
					expiresAt,
				};
			},
		);
	}
}
