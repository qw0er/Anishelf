import { MediaAccessLinkResponseSchema } from "@anishelf/contracts/schemas/authentication";
import { ResourceParamsSchema } from "@anishelf/contracts/schemas/common";
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
) {
	async function permits(method: string, url: URL) {
		if (method !== "GET" && method !== "HEAD") return false;
		const fileId = /^\/api\/media\/([A-Za-z0-9_-]+)$/.exec(url.pathname)?.[1];
		const token = url.searchParams.get("access_token");
		if (!fileId || !token || !opaqueTokenPattern.test(token)) return false;
		const link = store.readLink(digest(token), Date.now());
		return Boolean(
			link &&
				link.fileId === fileId &&
				link.fingerprint === service.fingerprint &&
				link.sourceVersion === (await sources.version(fileId)),
		);
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
