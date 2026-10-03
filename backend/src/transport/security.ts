import type { FastifyRequest } from "fastify";
import { developmentDefaults } from "../contracts/defaults.js";
import type { DeploymentConfig } from "../modules/configuration/public.js";
import { DomainError } from "../shared/errors.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const devOrigins = new Set<string>(developmentDefaults.origins);

type RequestOriginConfig = Pick<DeploymentConfig, "host" | "port">;

function parseRequestHost(request: FastifyRequest): URL {
	const host = request.headers.host;
	if (!host || !/^[a-zA-Z0-9.[\]:-]+$/.test(host))
		throw new DomainError("INVALID_REQUEST", "Invalid Host header.");
	try {
		return new URL(`http://${host}`);
	} catch {
		throw new DomainError("INVALID_REQUEST", "Invalid Host header.");
	}
}

function checkRequestHost(
	request: FastifyRequest,
	config: RequestOriginConfig,
): URL {
	const host = parseRequestHost(request);
	const expectedHostname = config.host === "::1" ? "[::1]" : config.host;
	const expectedPort = request.raw.socket.localPort ?? config.port;
	if (
		![expectedHostname, "localhost"].includes(host.hostname) ||
		Number(host.port || 80) !== expectedPort
	) {
		throw new DomainError("INVALID_REQUEST", "Unexpected Host header.");
	}
	return host;
}

function isSafeMethod(method: string): boolean {
	return safeMethods.has(method);
}

function checkOrigin(
	request: FastifyRequest,
	host: URL,
	development: boolean,
): void {
	const origin = request.headers.origin;
	if (origin === undefined) return;
	const sameOrigin = origin === `${request.protocol}://${host.host}`;
	const allowedDevelopmentOrigin = development && devOrigins.has(origin);
	if (!sameOrigin && !allowedDevelopmentOrigin)
		throw new DomainError("REQUEST_FORBIDDEN", "Untrusted request origin.");
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
	const host = checkRequestHost(request, config);
	if (isSafeMethod(request.method)) return;
	checkOrigin(request, host, development);
	checkFetchMetadata(request);
}
