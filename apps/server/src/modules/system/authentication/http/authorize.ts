import type { FastifyRequest } from "fastify";
import { DomainError } from "../../../../shared/errors.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import { isDirectLoopbackRequest } from "../../../../transport/security.js";
import type { AuthenticationService } from "../application.js";
import type { createDeviceSessions } from "../device-sessions.js";
import type { DeviceSession } from "../ports.js";
import { safeEqual } from "../tokens.js";
import { deviceLoginPath } from "./device-routes.js";
import type { createMediaLinks } from "./media-links.js";
import { isWebAuthenticated, sessionCookieName } from "./web-sessions.js";

const webSessionPaths = new Set([
	"/api/auth/session",
	"/api/auth/login",
	"/api/auth/logout",
]);

function requireDeviceTransport(request: FastifyRequest) {
	if (request.protocol === "https" || isDirectLoopbackRequest(request)) return;
	request.log.warn(
		{ event: "auth.device_insecure_transport" },
		"Device authentication requires HTTPS or direct loopback HTTP.",
	);
	throw new DomainError(
		"REQUEST_FORBIDDEN",
		"Device authentication requires HTTPS or direct loopback HTTP.",
	);
}

export function registerAuthorization(
	app: HttpInstance,
	service: AuthenticationService,
	sessions: ReturnType<typeof createDeviceSessions>,
	mediaLinks: ReturnType<typeof createMediaLinks>,
) {
	const devices = new WeakMap<FastifyRequest, DeviceSession>();
	const anonymousRoutes = new Set([
		"/api/auth/session",
		"/api/auth/login",
		"/api/health",
	]);
	app.addHook("onRequest", async function authorizeRequest(request, reply) {
		const url = new URL(request.url, "http://localhost");
		const { pathname: path } = url;
		if (!(path === "/api" || path.startsWith("/api/"))) return;
		reply.header("Cache-Control", "no-store");
		const route = request.routeOptions.url;
		const authorization = request.headers.authorization;
		if (request.method === "POST" && route === deviceLoginPath) {
			requireDeviceTransport(request);
			if (
				authorization !== undefined ||
				request.cookies[sessionCookieName] !== undefined
			)
				throw new DomainError(
					"REQUEST_FORBIDDEN",
					"Device sign-in requires a password without session credentials.",
				);
			return;
		}
		if (authorization !== undefined) {
			requireDeviceTransport(request);
			const device = sessions.authenticate(authorization);
			if (!device) {
				reply.header("WWW-Authenticate", 'Bearer realm="Anishelf"');
				request.log.debug(
					{ event: "auth.device_token_rejected" },
					"Device authentication rejected.",
				);
				throw new DomainError("AUTH_REQUIRED", "Sign in to continue.");
			}
			if (request.cookies[sessionCookieName] !== undefined)
				throw new DomainError(
					"REQUEST_FORBIDDEN",
					"Use one authentication method per request.",
				);
			if (route && webSessionPaths.has(route))
				throw new DomainError(
					"REQUEST_FORBIDDEN",
					"This route requires a browser session.",
				);
			devices.set(request, device);
			return;
		}
		// Cookie-only changes are excluded from @fastify/session's dirty tracking.
		// Persist the upgrade explicitly so the browser receives Secure immediately.
		if (request.protocol === "https" && !request.session.cookie.secure) {
			request.session.options({ secure: true });
			await request.session.save();
			request.log.info(
				{ event: "auth.session_transport_upgraded" },
				"Session cookie upgraded to HTTPS transport.",
			);
		}
		const safe = ["GET", "HEAD", "OPTIONS"].includes(request.method);
		if (!anonymousRoutes.has(path) && !isWebAuthenticated(request, service)) {
			if (await mediaLinks.permits(request.method, url)) return;
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
	return (request: FastifyRequest) => devices.get(request);
}
