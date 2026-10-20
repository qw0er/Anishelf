import type { FastifyRequest } from "fastify";
import { developmentDefaults } from "../contracts/defaults.js";
import type { DeploymentConfig } from "../modules/system/public.js";
import { DomainError } from "../shared/errors.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const devOrigins = new Set<string>(developmentDefaults.origins);

type RequestOriginConfig = Pick<
	DeploymentConfig,
	"host" | "port" | "publicOrigin"
>;

function parseRequestHost(request: FastifyRequest, protocol = "http:"): URL {
	const host = request.headers.host;
	if (!host || !/^[a-zA-Z0-9.[\]:-]+$/.test(host))
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
	if (config.publicOrigin) {
		const publicUrl = new URL(config.publicOrigin);
		const publicHost = parseRequestHost(request, publicUrl.protocol);
		if (publicHost.host === publicUrl.host) return config.publicOrigin;
	}
	const host = parseRequestHost(request);
	const expectedHostname = config.host.includes(":")
		? `[${config.host}]`
		: config.host;
	const localHostnames =
		config.host === "0.0.0.0" || config.host === "::"
			? ["127.0.0.1", "[::1]", "localhost"]
			: [expectedHostname, "localhost"];
	const expectedPort = request.raw.socket.localPort ?? config.port;
	if (
		!localHostnames.includes(host.hostname) ||
		Number(host.port || 80) !== expectedPort
	) {
		throw new DomainError("INVALID_REQUEST", "Unexpected Host header.");
	}
	return `${request.protocol}://${host.host}`;
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
	const expectedOrigin = checkRequestHost(request, config);
	if (isSafeMethod(request.method)) return;
	checkOrigin(request, expectedOrigin, development);
	checkFetchMetadata(request);
}
