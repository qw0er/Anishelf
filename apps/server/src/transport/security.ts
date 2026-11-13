import type { FastifyRequest } from "fastify";
import { developmentDefaults } from "../contracts/defaults.js";
import type { DeploymentConfig } from "../modules/system/public.js";
import { DomainError } from "../shared/errors.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const devOrigins = new Set<string>(developmentDefaults.origins);

type RequestOriginConfig = Pick<DeploymentConfig, "allowedHosts">;

function parseRequestHost(request: FastifyRequest, protocol = "http:"): URL {
	const host = request.headers.host;
	if (
		!host ||
		!/^[a-zA-Z0-9.[\]:-]+$/.test(host) ||
		!["http:", "https:"].includes(protocol)
	)
		throw new DomainError("INVALID_REQUEST", "Invalid Host header.");
	try {
		return new URL(`${protocol}//${host}`);
	} catch {
		throw new DomainError("INVALID_REQUEST", "Invalid Host header.");
	}
}

function checkRequestHost(
	request: FastifyRequest,
	config: RequestOriginConfig,
): string {
	const host = parseRequestHost(request, `${request.protocol}:`);
	if (
		config.allowedHosts?.length &&
		!config.allowedHosts.includes(host.hostname)
	) {
		request.log.warn(
			{ event: "http.host_rejected" },
			"Request hostname is not in ANISHELF_ALLOWED_HOSTS.",
		);
		throw new DomainError("NETWORK_HOST_REJECTED", "Hostname is not allowed.");
	}
	return host.origin;
}

function isSafeMethod(method: string): boolean {
	return safeMethods.has(method);
}

function checkOrigin(
	request: FastifyRequest,
	expectedOrigin: string,
	development: boolean,
): void {
	const origin = request.headers.origin;
	if (origin === undefined) return;
	const sameOrigin = origin === expectedOrigin;
	const allowedDevelopmentOrigin = development && devOrigins.has(origin);
	if (!sameOrigin && !allowedDevelopmentOrigin) {
		request.log.warn(
			{ event: "http.origin_rejected" },
			"Request Origin does not match its access address and trusted transport. Check proxy configuration.",
		);
		throw new DomainError(
			"NETWORK_ORIGIN_REJECTED",
			"Untrusted request origin.",
		);
	}
}

function checkFetchMetadata(request: FastifyRequest): void {
	if (request.headers["sec-fetch-site"] === "cross-site") {
		throw new DomainError(
			"REQUEST_FORBIDDEN",
			"Cross-site mutations are not allowed.",
		);
	}
}

export function checkRequestOrigin(
	request: FastifyRequest,
	config: RequestOriginConfig,
	development: boolean,
): void {
	const expectedOrigin = checkRequestHost(request, config);
	if (isSafeMethod(request.method)) return;
	checkOrigin(request, expectedOrigin, development);
	checkFetchMetadata(request);
}
