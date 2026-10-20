import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import session from "@fastify/session";
import type { FastifyReply, FastifyRequest, Session } from "fastify";
import type { Logger } from "pino";
import {
	AuthSessionResponseSchema,
	ChangePasswordRequestSchema,
	LoginRequestSchema,
	MediaAccessLinkResponseSchema,
} from "../../../../contracts/schemas/authentication.js";
import { ResourceParamsSchema } from "../../../../contracts/schemas/common.js";
import { DomainError } from "../../../../shared/errors.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { AuthenticationService } from "../application.js";
import { authenticationFailure } from "../diagnostics.js";
import type { AuthenticationStore } from "../ports.js";

declare module "fastify" {
	interface Session {
		authFingerprint?: string;
		authExpiresAt?: number;
		csrfToken?: string;
	}
}
const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
const linkLifetime = 24 * 60 * 60 * 1000;
function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
function safeEqual(left: string, right: string): boolean {
	return timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right)));
}
export interface MediaLinkSources {
	version(id: string): Promise<string>;
}
export async function registerAuthentication(
	app: HttpInstance,
	options: {
		service: AuthenticationService;
		logger: Logger;
		sessionPath: string;
		secret: string;
		store: AuthenticationStore;
		secure: boolean;
		sources: MediaLinkSources;
	},
) {
	const service = options.service;
	const store = options.store;
	function sessionFailure(operation: string, error: unknown): Error {
		options.logger.error(
			{
				event: "auth.session_store_failed",
				operation,
				path: options.sessionPath,
				...authenticationFailure(error),
			},
			"Authentication session storage failed.",
		);
		return new Error("Authentication session storage failed.");
	}
	await app.register(cookie);
	await app.register(session, {
		secret: options.secret,
		cookieName: "anishelf_session",
		rolling: false,
		saveUninitialized: false,
		cookie: {
			path: "/",
			httpOnly: true,
			sameSite: "lax",
			secure: options.secure,
			maxAge: sessionLifetime,
		},
		store: {
			set(id, data, callback) {
				try {
					store.saveSession(
						id,
						JSON.stringify(data),
						data.authExpiresAt ?? Date.now() + 15 * 60 * 1000,
					);
					callback();
				} catch (error) {
					callback(sessionFailure("save_session", error));
				}
			},
			get(id, callback) {
				try {
					const data = store.readSession(id, Date.now());
					callback(null, data ? (JSON.parse(data) as Session) : null);
				} catch (error) {
					callback(sessionFailure("read_session", error));
				}
			},
			destroy(id, callback) {
				try {
					store.deleteSession(id);
					callback();
				} catch (error) {
					callback(sessionFailure("delete_session", error));
				}
			},
		},
	});
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
	function authenticated(request: FastifyRequest): boolean {
		return (
			request.session.authFingerprint === service.fingerprint &&
			(request.session.authExpiresAt ?? 0) > Date.now()
		);
	}
	const anonymousRoutes = new Set([
		"/api/auth/session",
		"/api/auth/login",
		"/api/health",
	]);
	app.addHook("onRequest", async function authorizeRequest(request, reply) {
		const path = new URL(request.url, "http://localhost").pathname;
		if (!(path === "/api" || path.startsWith("/api/"))) return;
		reply.header("Cache-Control", "no-store");
		const safe = ["GET", "HEAD", "OPTIONS"].includes(request.method);
		if (!anonymousRoutes.has(path) && !authenticated(request)) {
			const match = /^\/api\/media\/([A-Za-z0-9_-]+)$/.exec(path);
			const token = new URL(request.url, "http://localhost").searchParams.get(
				"access_token",
			);
			if (
				match &&
				["GET", "HEAD"].includes(request.method) &&
				token &&
				/^[A-Za-z0-9_-]{43}$/.test(token)
			) {
				const link = store.readLink(digest(token), Date.now());
				if (
					link &&
					link.fileId === match[1] &&
					link.fingerprint === service.fingerprint &&
					link.sourceVersion === (await options.sources.version(link.fileId))
				)
					return;
			}
			throw new DomainError("AUTH_REQUIRED", "Sign in to continue.");
		}
		if (!safe) {
			const provided = request.headers["x-csrf-token"];
			if (
				typeof provided !== "string" ||
				!request.session.csrfToken ||
				!safeEqual(provided, request.session.csrfToken)
			)
				throw new DomainError("REQUEST_FORBIDDEN", "Invalid CSRF token.");
		}
	});
	app.get(
		"/api/auth/session",
		{
			schema: { response: { 200: AuthSessionResponseSchema } },
			preHandler: app.rateLimit({ max: 120, timeWindow: "1 minute" }),
		},
		async function sessionStatus(request) {
			request.session.csrfToken ??= randomBytes(32).toString("base64url");
			return {
				authenticated: authenticated(request),
				csrfToken: request.session.csrfToken,
			};
		},
	);
	app.post(
		"/api/auth/login",
		{
			schema: {
				body: LoginRequestSchema,
				response: { 200: AuthSessionResponseSchema },
			},
			preHandler: [
				loginLimit(globalLoginLimit, "instance"),
				loginLimit(sourceLoginLimit, "source"),
			],
			onResponse: async function logLoginCompletion(request, reply) {
				if (reply.statusCode === 200)
					request.log.info(
						{ event: "auth.login_succeeded", source: request.ip },
						"Authentication login succeeded.",
					);
			},
		},
		async function login(request) {
			const expected = service.fingerprint;
			if (
				!(await service.verify(request.body.password)) ||
				service.fingerprint !== expected
			) {
				request.log.warn(
					{
						event: "auth.login_failed",
						reason: "invalid_password",
						source: request.ip,
					},
					"Authentication login rejected.",
				);
				throw new DomainError("AUTH_REQUIRED", "Invalid password.");
			}
			await request.session.regenerate();
			request.session.authFingerprint = expected;
			request.session.authExpiresAt = Date.now() + sessionLifetime;
			request.session.csrfToken = randomBytes(32).toString("base64url");
			return { authenticated: true, csrfToken: request.session.csrfToken };
		},
	);
	app.post("/api/auth/logout", async function logout(request, reply) {
		await request.session.destroy();
		reply.clearCookie("anishelf_session", {
			path: "/",
			secure: options.secure,
			httpOnly: true,
			sameSite: "lax",
		});
		request.log.info(
			{ event: "auth.logout_succeeded" },
			"Authentication logout succeeded.",
		);
		return reply.code(204).send();
	});
	app.put(
		"/api/auth/password",
		{
			schema: { body: ChangePasswordRequestSchema },
			preHandler: [
				loginLimit(globalLoginLimit, "instance"),
				loginLimit(sourceLoginLimit, "source"),
			],
		},
		async function changePassword(request, reply) {
			try {
				await service.change(
					request.body.currentPassword,
					request.body.password,
				);
			} catch (error) {
				if (error instanceof DomainError && error.code === "AUTH_REQUIRED")
					request.log.warn(
						{
							event: "auth.password_change_rejected",
							reason: "invalid_current_password",
							source: request.ip,
						},
						"Password change rejected.",
					);
				throw error;
			}
			store.clear();
			await request.session.destroy();
			reply.clearCookie("anishelf_session", {
				path: "/",
				secure: options.secure,
				httpOnly: true,
				sameSite: "lax",
			});
			request.log.info(
				{ event: "auth.password_changed" },
				"Authentication password changed; all sessions and media links revoked.",
			);
			return reply.code(204).send();
		},
	);
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
			const sourceVersion = await options.sources.version(request.params.id);
			if (expected !== service.fingerprint)
				throw new DomainError("AUTH_REQUIRED", "Sign in again.");
			const token = randomBytes(32).toString("base64url");
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
