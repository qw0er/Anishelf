import {
	AuthSessionResponseSchema,
	ChangePasswordRequestSchema,
	LoginRequestSchema,
} from "@anishelf/contracts/schemas/authentication";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import type { FastifyReply, FastifyRequest, Session } from "fastify";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { AuthenticationService } from "../application.js";
import { authenticationFailure } from "../diagnostics.js";
import type { AuthenticationStore } from "../ports.js";
import { createToken, sessionLifetime } from "../tokens.js";
import { type createLoginLimits, verifyLogin } from "./login.js";

declare module "fastify" {
	interface Session {
		authFingerprint?: string;
		authExpiresAt?: number;
		csrfToken?: string;
	}
}
export const sessionCookieName = "anishelf_session";
const sessionCookie = {
	path: "/",
	httpOnly: true,
	sameSite: "lax",
	secure: "auto",
} as const;

export async function registerWebSessionStore(
	app: HttpInstance,
	options: {
		logger: Logger;
		sessionPath: string;
		secret: string;
		store: AuthenticationStore;
	},
) {
	const { store } = options;
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
		cookieName: sessionCookieName,
		rolling: false,
		saveUninitialized: false,
		cookie: {
			...sessionCookie,
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
}

export function isWebAuthenticated(
	request: FastifyRequest,
	service: AuthenticationService,
): boolean {
	return (
		request.session.authFingerprint === service.fingerprint &&
		(request.session.authExpiresAt ?? 0) > Date.now()
	);
}

async function clearWebSession(request: FastifyRequest, reply: FastifyReply) {
	await request.session.destroy();
	reply.clearCookie(sessionCookieName, sessionCookie);
}

export function registerWebSessionRoutes(
	app: HttpInstance,
	service: AuthenticationService,
	store: AuthenticationStore,
	loginLimits: Awaited<ReturnType<typeof createLoginLimits>>,
) {
	app.get(
		"/api/auth/session",
		{
			schema: { response: { 200: AuthSessionResponseSchema } },
			preHandler: app.rateLimit({ max: 120, timeWindow: "1 minute" }),
		},
		async function sessionStatus(request) {
			request.session.csrfToken ??= createToken();
			return {
				authenticated: isWebAuthenticated(request, service),
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
			preHandler: loginLimits,
			onResponse: async function logLoginCompletion(request, reply) {
				if (reply.statusCode === 200)
					request.log.info(
						{ event: "auth.login_succeeded", source: request.ip },
						"Authentication login succeeded.",
					);
			},
		},
		async function login(request) {
			const expected = await verifyLogin(
				service,
				request,
				request.body.password,
				"cookie",
			);
			await request.session.regenerate();
			request.session.authFingerprint = expected;
			request.session.authExpiresAt = Date.now() + sessionLifetime;
			request.session.csrfToken = createToken();
			return { authenticated: true, csrfToken: request.session.csrfToken };
		},
	);
	app.post("/api/auth/logout", async function logout(request, reply) {
		await clearWebSession(request, reply);
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
			preHandler: loginLimits,
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
			await clearWebSession(request, reply);
			request.log.info(
				{ event: "auth.password_changed" },
				"Authentication password changed; browser sessions, device sessions and media links revoked.",
			);
			return reply.code(204).send();
		},
	);
}
