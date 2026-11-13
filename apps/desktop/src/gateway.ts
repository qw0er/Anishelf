import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { access } from "node:fs/promises";
import {
	createServer,
	request as httpRequest,
	type IncomingHttpHeaders,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { ApiClientError } from "@anishelf/client-core";
import send from "@fastify/send";
import type { DesktopDeviceSession } from "./device-session.js";

const gatewayHost = "127.0.0.1";
const hopHeaders = [
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"proxy-connection",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
];

function endToEndHeaders(headers: IncomingHttpHeaders) {
	const result = { ...headers };
	for (const name of headers.connection?.split(",") ?? []) {
		delete result[name.trim().toLowerCase()];
	}
	for (const name of hopHeaders) delete result[name];
	return result;
}

function badGateway(response: ServerResponse, error: unknown) {
	if (response.destroyed || response.writableEnded) return;
	const requestId = randomUUID();
	console.warn("desktop.gateway_upstream_failed", { requestId, error });
	if (response.headersSent) {
		response.destroy();
		return;
	}
	response.writeHead(502, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
		"x-request-id": requestId,
	});
	response.end(
		JSON.stringify({
			error: {
				code: "INTERNAL_ERROR",
				message:
					"Cannot connect to the server. Check your connection and try again.",
				requestId,
			},
		}),
	);
}

function proxyApi(
	request: IncomingMessage,
	response: ServerResponse,
	url: URL,
	target: URL,
	device: DesktopDeviceSession | undefined,
	trusted: boolean,
) {
	const headers = endToEndHeaders(request.headers);
	for (const name of Object.keys(headers)) {
		if (name === "forwarded" || name.startsWith("x-forwarded-"))
			delete headers[name];
	}
	headers.host = target.host;
	delete headers["x-anishelf-desktop"];
	if (device) {
		delete headers.cookie;
		delete headers.authorization;
		const authorization = trusted ? device.authorization() : undefined;
		if (authorization) headers.authorization = authorization;
	}
	if (request.headers.origin) headers.origin = target.origin;

	const sendRequest = target.protocol === "https:" ? httpsRequest : httpRequest;
	const upstream = sendRequest(
		target,
		{ method: request.method, path: `${url.pathname}${url.search}`, headers },
		(upstreamResponse) => {
			const headers = endToEndHeaders(upstreamResponse.headers);
			if (device) delete headers["set-cookie"];
			// API responses must not run scripts as documents on the renderer origin.
			headers["content-security-policy"] = "sandbox";
			headers["x-content-type-options"] = "nosniff";
			response.writeHead(upstreamResponse.statusCode ?? 502, headers);
			void pipeline(upstreamResponse, response).catch((error: unknown) => {
				if (
					error instanceof Error &&
					"code" in error &&
					error.code === "ERR_STREAM_PREMATURE_CLOSE"
				)
					return;
				console.warn("desktop.gateway_response_interrupted", { error });
			});
		},
	);
	upstream.on("error", (error) => badGateway(response, error));
	response.once("close", () => {
		if (!response.writableFinished) upstream.destroy();
	});
	request.pipe(upstream);
}

async function handleDeviceSession(
	request: IncomingMessage,
	response: ServerResponse,
	device: DesktopDeviceSession,
) {
	try {
		if (request.method === "GET") {
			const session = await device.getSession();
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify(session));
			return;
		}
		if (request.method === "POST") {
			let body = "";
			request.setEncoding("utf8");
			for await (const chunk of request.iterator({ destroyOnReturn: false })) {
				body += chunk;
				if (body.length > 2048) break;
			}
			let password: unknown;
			try {
				if (body.length <= 2048) password = JSON.parse(body)?.password;
			} catch {
				/* Invalid JSON is handled below. */
			}
			if (typeof password !== "string" || !password || password.length > 128) {
				response.writeHead(400).end();
				return;
			}
			await device.signIn(password);
		} else if (request.method === "DELETE") {
			await device.signOut();
		} else {
			response.writeHead(405, { allow: "GET, POST, DELETE" }).end();
			return;
		}
		response.writeHead(204).end();
	} catch (error) {
		if (!(error instanceof ApiClientError)) {
			badGateway(response, error);
			return;
		}
		response.writeHead(error.status ?? 502, {
			"content-type": "application/json",
		});
		response.end(
			JSON.stringify({
				error: {
					message: error.message,
					code: error.code ?? "INTERNAL_ERROR",
					requestId: error.requestId ?? randomUUID(),
				},
			}),
		);
	}
}

async function serveRenderer(
	request: IncomingMessage,
	response: ServerResponse,
	pathname: string,
	root: string,
) {
	if (request.method !== "GET" && request.method !== "HEAD") {
		response.writeHead(405, { allow: "GET, HEAD" }).end();
		return;
	}
	const asset = pathname.startsWith("/assets/");
	if (
		!asset &&
		pathname !== "/" &&
		pathname !== "/index.html" &&
		!request.headers.accept?.includes("text/html")
	) {
		response.writeHead(404).end();
		return;
	}
	const file = await send(
		request,
		asset ? pathname.slice("/assets".length) : "/index.html",
		{
			root: asset ? join(root, "assets") : root,
			index: false,
			dotfiles: "deny",
			immutable: asset,
			maxAge: asset ? "1y" : 0,
		},
	);
	if (file.type === "directory") {
		file.stream.destroy();
		response.writeHead(404).end();
		return;
	}
	response.writeHead(file.statusCode, file.headers);
	await pipeline(file.stream, response);
}

export async function startDesktopGateway({
	rendererRoot,
	target,
	port,
	device,
}: {
	rendererRoot: string;
	target: URL;
	port: number;
	device?: DesktopDeviceSession;
}) {
	const secret = randomBytes(32).toString("base64url");
	await access(join(rendererRoot, "index.html"));
	const url = new URL(`http://${gatewayHost}:${port}`);
	if (
		target.origin === url.origin ||
		target.origin === `http://localhost:${port}`
	)
		throw new Error(
			"The desktop gateway and backend require different addresses.",
		);
	const server = createServer((request, response) => {
		response.setHeader("referrer-policy", "no-referrer");
		response.setHeader("x-content-type-options", "nosniff");
		const path = request.url;
		if (request.headers.host !== url.host || !path?.startsWith("/")) {
			response.writeHead(400).end();
			return;
		}
		const requestUrl = URL.parse(path, url);
		if (!requestUrl || requestUrl.origin !== url.origin) {
			response.writeHead(400).end();
			return;
		}
		if (
			requestUrl.pathname === "/api" ||
			requestUrl.pathname.startsWith("/api/")
		) {
			const trusted = request.headers["x-anishelf-desktop"] === secret;
			const externalMedia =
				(request.method === "GET" || request.method === "HEAD") &&
				/^\/api\/media\/[A-Za-z0-9_-]+$/.test(requestUrl.pathname) &&
				requestUrl.searchParams.has("access_token");
			const origin = request.headers.origin;
			const site = request.headers["sec-fetch-site"];
			if (
				(device && !trusted && !externalMedia) ||
				(origin && origin !== url.origin) ||
				site === "cross-site" ||
				site === "same-site"
			) {
				response.writeHead(403, { "cache-control": "no-store" }).end();
				return;
			}
			if (requestUrl.pathname === "/api/desktop/session") {
				response.setHeader("cache-control", "no-store");
				if (device) void handleDeviceSession(request, response, device);
				else response.writeHead(404).end();
				return;
			}
			// Only the main process can issue credentials. With a bearer header,
			// the upstream device login endpoint rejects the request as well.
			if (
				device &&
				!externalMedia &&
				!device.authorization() &&
				requestUrl.pathname !== "/api/health"
			) {
				response.writeHead(401, { "cache-control": "no-store" }).end();
				return;
			}
			proxyApi(request, response, requestUrl, target, device, trusted);
			return;
		}
		if (
			requestUrl.pathname === "/desktop-config.json" &&
			request.method === "GET"
		) {
			response.writeHead(200, {
				"content-type": "application/json",
				"cache-control": "no-store",
			});
			response.end(JSON.stringify({ deviceAuthentication: Boolean(device) }));
			return;
		}
		void serveRenderer(
			request,
			response,
			requestUrl.pathname,
			rendererRoot,
		).catch((error: unknown) => {
			if (response.destroyed) return;
			console.error("desktop.gateway_renderer_failed", { error });
			if (response.headersSent) response.destroy();
			else response.writeHead(500).end();
		});
	});
	server.listen(port, gatewayHost);
	await once(server, "listening");
	server.on("error", (error) =>
		console.error("desktop.gateway_failed", { error }),
	);
	console.info("desktop.gateway_started", {
		origin: url.origin,
		upstream: target.origin,
	});
	return {
		url,
		secret,
		close() {
			server.close();
			server.closeAllConnections();
			console.info("desktop.gateway_stopped");
		},
	};
}
