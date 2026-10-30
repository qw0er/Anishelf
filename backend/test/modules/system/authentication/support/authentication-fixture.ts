import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, vi } from "vitest";
import { ApplicationDatabase } from "../../../../../src/app/bootstrap/database.js";
import { createHttpApp } from "../../../../../src/app/bootstrap/http.js";
import { createAuthenticationModule } from "../../../../../src/modules/system/create.js";

const directories: string[] = [];

export const apps: ReturnType<typeof createHttpApp>[] = [];

export const headers = { host: "127.0.0.1:3000" };

export async function directory() {
	const path = await mkdtemp(join(tmpdir(), "anishelf-auth-"));
	directories.push(path);
	return path;
}

export async function application(
	dataDir = "",
	secure = false,
	logger = pino({ enabled: false }),
	trustedProxies?: string[],
) {
	dataDir ||= await directory();
	const database = ApplicationDatabase.open(dataDir);
	let version = "version-one";
	const auth = await createAuthenticationModule({
		logger,
		dataDir,

		store: database.authentication,
		sources: { version: async () => version },
	});
	const app = createHttpApp({
		config: {
			host: "127.0.0.1",
			port: 3000,
			...(secure ? { publicOrigin: "https://example.com" } : {}),
			...(trustedProxies ? { trustedProxies } : {}),
		},
		logger,
		configure: auth.registerHttp,
		registrations: [
			(scope) => {
				for (const path of [
					"/api/settings",
					"/api/subtitles/file",
					"/api/fonts/file",
					"/api/artwork/file",
					"/api/preparation/file",
				])
					scope.get(path, async () => ({ private: true }));
				scope.route({
					method: ["GET", "HEAD"],
					url: "/api/media/:id",
					handler: async (request, reply) => {
						if (request.headers.range)
							reply.code(206).header("content-range", "bytes 0-3/10");
						return reply.send("test");
					},
				});
				scope.post("/api/test", async () => ({ ok: true }));
			},
		],
		closeDependencies: async () => database.close(),
	});
	apps.push(app);
	await app.ready();
	return {
		app,
		dataDir,
		database,
		password: auth.initialPassword,
		version: (next: string) => {
			version = next;
		},
	};
}

export async function browser(
	app: Awaited<ReturnType<typeof application>>["app"],
	password: string,
) {
	const preflight = await app.inject({ url: "/api/auth/session", headers });
	let cookie = preflight.cookies
		.map((item) => `${item.name}=${encodeURIComponent(item.value)}`)
		.join("; ");
	const login = await app.inject({
		url: "/api/auth/login",
		method: "POST",
		headers: { ...headers, cookie, "x-csrf-token": preflight.json().csrfToken },
		payload: { password },
	});
	expect(login.statusCode, login.body).toBe(200);
	cookie = login.cookies
		.map((item) => `${item.name}=${encodeURIComponent(item.value)}`)
		.join("; ");
	return { cookie, csrf: login.json().csrfToken, login };
}

export function setupTestLifecycle() {
	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(apps.splice(0).map((app) => app.close()));
		await Promise.all(
			directories
				.splice(0)
				.map((path) => rm(path, { recursive: true, force: true })),
		);
	});
}
