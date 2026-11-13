import rateLimit from "@fastify/rate-limit";
import type { FastifyReply, FastifyRequest } from "fastify";
import { DomainError } from "../../../../shared/errors.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { AuthenticationService } from "../application.js";

export async function createLoginLimits(app: HttpInstance) {
	await app.register(rateLimit, { global: false });
	const globalLoginLimit = app.createRateLimit({
		max: 100,
		timeWindow: "1 minute",
		keyGenerator: instanceLoginKey,
	});
	const sourceLoginLimit = app.createRateLimit({
		max: 10,
		timeWindow: "1 minute",
		keyGenerator: requestSourceKey,
	});
	function instanceLoginKey(): string {
		return "login";
	}
	function requestSourceKey(request: FastifyRequest): string {
		return request.ip;
	}
	function loginLimit(
		limiter: ReturnType<typeof app.createRateLimit>,
		scope: "instance" | "source",
	) {
		return async function enforceLoginLimit(
			request: FastifyRequest,
			reply: FastifyReply,
		) {
			const result = await limiter(request);
			if (!result.isAllowed && result.isExceeded) {
				request.log.warn(
					{ event: "auth.login_rate_limited", scope, source: request.ip },
					"Authentication attempt rate limit exceeded.",
				);
				reply.header("Retry-After", result.ttlInSeconds);
				throw new DomainError("AUTH_RATE_LIMITED", "Too many login attempts.");
			}
		};
	}
	return [
		loginLimit(globalLoginLimit, "instance"),
		loginLimit(sourceLoginLimit, "source"),
	];
}

export async function verifyLogin(
	service: AuthenticationService,
	request: FastifyRequest,
	password: string,
	method: "cookie" | "device",
) {
	const expected = service.fingerprint;
	if (!(await service.verify(password)) || service.fingerprint !== expected) {
		request.log.warn(
			{
				event: "auth.login_failed",
				method,
				reason: "invalid_password",
				source: request.ip,
			},
			"Authentication login rejected.",
		);
		throw new DomainError("AUTH_REQUIRED", "Invalid password.");
	}
	return expected;
}
