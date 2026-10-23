import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import {
	ApplicationDatabase,
	openDatabase,
} from "../src/app/bootstrap/database.js";
import { createHttpApp } from "../src/app/bootstrap/http.js";
import { builtinPolicy } from "../src/app/policy.js";
import {
	hashPassword,
	loadCredentials,
	replaceCredential,
	verifyPassword,
} from "../src/modules/system/authentication/infrastructure/credentials.js";
import { createAuthenticationModule } from "../src/modules/system/create.js";

const directories: string[] = [];
const apps: ReturnType<typeof createHttpApp>[] = [];
const headers = { host: "127.0.0.1:3000" };
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(apps.splice(0).map((app) => app.close()));
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
async function directory() {
	const path = await mkdtemp(join(tmpdir(), "anishelf-auth-"));
	directories.push(path);
	return path;
}
async function application(
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
		secure,
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
		policy: builtinPolicy,
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
async function browser(
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

test("credentials initialize once, privately and without storing the password", async () => {
	const path = await directory();
	const results = await Promise.all([
		loadCredentials(path),
		loadCredentials(path),
	]);
	expect(results.filter((result) => result.initialPassword)).toHaveLength(1);
	const winner = results.find((result) => result.initialPassword);
	expect(
		await verifyPassword(winner?.initialPassword ?? "", results[0].credential),
	).toBe(true);
	expect(results[0].credential).toEqual(results[1].credential);
	expect((await stat(join(path, "auth.json"))).mode & 0o777).toBe(0o600);
	expect((await stat(path)).mode & 0o777).toBe(0o700);
	expect(await readFile(join(path, "auth.json"), "utf8")).not.toContain(
		winner?.initialPassword,
	);
	expect((await loadCredentials(path)).initialPassword).toBeUndefined();
	await writeFile(join(path, "auth.json"), "broken");
	await expect(loadCredentials(path)).rejects.toThrow();
	expect(await readFile(join(path, "auth.json"), "utf8")).toBe("broken");
});

test("passwords trim outer whitespace and require eight characters", async () => {
	const credential = await hashPassword("  correct-horse  ");
	expect(await verifyPassword("correct-horse", credential)).toBe(true);
	expect(await verifyPassword("  correct-horse  ", credential)).toBe(true);
	const internal = await hashPassword("pass word");
	expect(await verifyPassword("pass word", internal)).toBe(true);
	expect(await verifyPassword("password", internal)).toBe(false);
	await expect(hashPassword("       ")).rejects.toThrow("8–128");
	await expect(hashPassword("1234567")).rejects.toThrow("8–128");
	await expect(hashPassword("12345678")).resolves.toMatchObject({
		algorithm: "scrypt",
	});
});

test("anonymous API and media requests are blocked, including HEAD and Range", async () => {
	const { app } = await application();
	for (const url of [
		"/api/settings",
		"/api/subtitles/file",
		"/api/fonts/file",
		"/api/artwork/file",
		"/api/preparation/file",
		"/api/media/file",
	]) {
		expect((await app.inject({ url, headers })).statusCode).toBe(401);
		expect(
			(
				await app.inject({
					url,
					method: "HEAD",
					headers: { ...headers, range: "bytes=0-3" },
				})
			).statusCode,
		).toBe(401);
	}
	expect((await app.inject({ url: "/api/health", headers })).statusCode).toBe(
		200,
	);
	expect(
		(await app.inject({ url: "/api/auth/session", headers })).json()
			.authenticated,
	).toBe(false);
});

test("login rotates cookie, enforces CSRF and Origin, logout revokes session", async () => {
	const { app, password } = await application();
	const { cookie, csrf, login } = await browser(app, password ?? "");
	expect(login.headers["set-cookie"]).toContain("HttpOnly");
	expect(login.headers["set-cookie"]).toContain("SameSite=Lax");
	expect(
		(
			await app.inject({
				url: "/api/settings",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(200);
	expect(
		(
			await app.inject({
				url: "/api/test",
				method: "POST",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(403);
	expect(
		(
			await app.inject({
				url: "/api/test",
				method: "POST",
				headers: {
					...headers,
					cookie,
					"x-csrf-token": csrf,
					origin: "https://evil.test",
				},
			})
		).statusCode,
	).toBe(403);
	expect(
		(
			await app.inject({
				url: "/api/test",
				method: "POST",
				headers: { ...headers, cookie, "x-csrf-token": csrf },
			})
		).statusCode,
	).toBe(200);
	expect(
		(
			await app.inject({
				url: "/api/auth/logout",
				method: "POST",
				headers: { ...headers, cookie, "x-csrf-token": csrf },
			})
		).statusCode,
	).toBe(204);
	expect(
		(
			await app.inject({
				url: "/api/settings",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(401);
});

test("sessions and scoped links survive restart; replacing auth.json revokes both", async () => {
	const first = await application();
	const { cookie, csrf } = await browser(first.app, first.password ?? "");
	const link = await first.app.inject({
		url: "/api/media/file/access-link",
		method: "POST",
		headers: { ...headers, cookie, "x-csrf-token": csrf },
	});
	expect(link.statusCode, link.body).toBe(200);
	const url = link.json().url as string;
	expect(
		(
			await first.app.inject({
				url,
				headers: { ...headers, range: "bytes=0-3" },
			})
		).statusCode,
	).toBe(206);
	expect(
		(await first.app.inject({ url, method: "HEAD", headers })).statusCode,
	).toBe(200);
	expect(
		(await first.app.inject({ url: url.replace("/file?", "/other?"), headers }))
			.statusCode,
	).toBe(401);
	const token =
		new URL(url, "http://localhost").searchParams.get("access_token") ?? "";
	expect(
		(
			await first.app.inject({
				url: `/api/settings?access_token=${token}`,
				headers,
			})
		).statusCode,
	).toBe(401);
	first.version("version-two");
	expect((await first.app.inject({ url, headers })).statusCode).toBe(401);
	await first.app.close();
	apps.splice(apps.indexOf(first.app), 1);
	const second = await application(first.dataDir);
	expect(second.password).toBeUndefined();
	expect(
		(
			await second.app.inject({
				url: "/api/settings",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(200);
	expect((await second.app.inject({ url, headers })).statusCode).toBe(200);
	await second.app.close();
	apps.splice(apps.indexOf(second.app), 1);
	await replaceCredential(
		first.dataDir,
		await hashPassword("replacement-password"),
	);
	const third = await application(first.dataDir);
	expect(
		(
			await third.app.inject({
				url: "/api/settings",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(401);
	expect((await third.app.inject({ url, headers })).statusCode).toBe(401);
	await browser(third.app, "replacement-password");
});

test("password change invalidates sessions, rejects incorrect current password and trims outer spaces", async () => {
	const { app, password } = await application();
	const first = await browser(app, password ?? "");
	const second = await browser(app, password ?? "");
	const link = (
		await app.inject({
			url: "/api/media/file/access-link",
			method: "POST",
			headers: { ...headers, cookie: first.cookie, "x-csrf-token": first.csrf },
		})
	).json().url;
	const change = (currentPassword: string, next = "new-password-long") =>
		app.inject({
			url: "/api/auth/password",
			method: "PUT",
			headers: { ...headers, cookie: first.cookie, "x-csrf-token": first.csrf },
			payload: { currentPassword, password: next },
		});
	expect((await change("wrong-password")).statusCode).toBe(401);
	expect((await change(password ?? "", "1234567")).statusCode).toBe(400);
	expect((await change(password ?? "", "        ")).statusCode).toBe(400);
	expect(
		(await change(`  ${password ?? ""}  `, "  new-password-long  ")).statusCode,
	).toBe(204);
	for (const cookie of [first.cookie, second.cookie])
		expect(
			(
				await app.inject({
					url: "/api/settings",
					headers: { ...headers, cookie },
				})
			).statusCode,
		).toBe(401);
	expect((await app.inject({ url: link, headers })).statusCode).toBe(401);
	await browser(app, "  new-password-long  ");
});

test("login attempts are limited and include Retry-After", async () => {
	const output: string[] = [];
	const logger = pino(
		{ level: "info" },
		{
			write(line) {
				output.push(line);
			},
		},
	);
	const { app } = await application("", false, logger);
	const init = await app.inject({ url: "/api/auth/session", headers });
	const cookie = init.cookies
		.map((item) => `${item.name}=${encodeURIComponent(item.value)}`)
		.join("; ");
	let status = 0;
	for (let index = 0; index < 12; index++) {
		const response = await app.inject({
			url: "/api/auth/login",
			method: "POST",
			headers: { ...headers, cookie, "x-csrf-token": init.json().csrfToken },
			payload: { password: "wrong" },
		});
		status = response.statusCode;
		expect([401, 429]).toContain(status);
		if (status === 429) expect(response.headers["retry-after"]).toBeDefined();
	}
	expect(status).toBe(429);
	expect(output.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({
			event: "auth.login_rate_limited",
			level: 40,
			scope: "source",
		}),
	);
});

test("HTTPS proxy uses secure cookie while direct untrusted forwarded headers do not establish sessions", async () => {
	const { app } = await application("", true);
	const response = await app.inject({
		url: "/api/auth/session",
		headers: { host: "example.com", "x-forwarded-proto": "https" },
		remoteAddress: "127.0.0.1",
	});
	expect(response.headers["set-cookie"]).toContain("Secure");
	const untrusted = await app.inject({
		url: "/api/auth/session",
		headers: { host: "example.com", "x-forwarded-proto": "https" },
		remoteAddress: "10.0.0.2",
	});
	expect(untrusted.headers["set-cookie"]).toBeUndefined();
});

test("session and media authorization expire at fixed deadlines", async () => {
	const { app, password } = await application();
	const { cookie, csrf } = await browser(app, password ?? "");
	const issuedAt = Date.now();
	const link = (
		await app.inject({
			url: "/api/media/file/access-link",
			method: "POST",
			headers: { ...headers, cookie, "x-csrf-token": csrf },
		})
	).json().url;
	const clock = vi
		.spyOn(Date, "now")
		.mockReturnValue(issuedAt + 86400000 + 1000);
	expect((await app.inject({ url: link, headers })).statusCode).toBe(401);
	expect(
		(
			await app.inject({
				url: "/api/settings",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(200);
	clock.mockReturnValue(issuedAt + 31 * 86400000);
	expect(
		(
			await app.inject({
				url: "/api/settings",
				headers: { ...headers, cookie },
			})
		).statusCode,
	).toBe(401);
});

test("corrupt authentication persistence blocks startup without initializing a password", async () => {
	const path = await directory();
	await writeFile(join(path, "anishelf.sqlite"), "broken database");
	expect(() =>
		openDatabase(path, pino({ enabled: false }), builtinPolicy),
	).toThrow();
	await expect(readFile(join(path, "auth.json"))).rejects.toMatchObject({
		code: "ENOENT",
	});
});

test("unsupported credentials and invalid signing keys fail closed", async () => {
	const path = await directory();
	const loaded = await loadCredentials(path);
	await writeFile(
		join(path, "auth.json"),
		JSON.stringify({ ...loaded.credential, version: 2 }),
	);
	await expect(loadCredentials(path)).rejects.toThrow("Invalid auth.json");
	await replaceCredential(path, loaded.credential);
	await writeFile(join(path, "auth-session.key"), "invalid key");
	await expect(loadCredentials(path)).rejects.toThrow(
		"Invalid auth-session.key",
	);
});

test("instance-wide login budget also blocks attempts from a fresh source", async () => {
	const output: string[] = [];
	const logger = pino(
		{ level: "info" },
		{
			write(line) {
				output.push(line);
			},
		},
	);
	const { app } = await application("", false, logger);
	const init = await app.inject({ url: "/api/auth/session", headers });
	const cookie = init.cookies
		.map((item) => `${item.name}=${encodeURIComponent(item.value)}`)
		.join("; ");
	for (let count = 0; count < 100; count++)
		await app.inject({
			url: "/api/auth/login",
			method: "POST",
			headers: { ...headers, cookie, "x-csrf-token": init.json().csrfToken },
			payload: { password: "wrong" },
		});
	const response = await app.inject({
		url: "/api/auth/login",
		method: "POST",
		remoteAddress: "10.0.0.2",
		headers: { ...headers, cookie, "x-csrf-token": init.json().csrfToken },
		payload: { password: "wrong" },
	});
	expect(response.statusCode).toBe(429);
	expect(output.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({
			event: "auth.login_rate_limited",
			level: 40,
			scope: "instance",
			source: "10.0.0.2",
		}),
	);
	expect(response.json().error.code).toBe("AUTH_RATE_LIMITED");
	expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
});

test("authentication lifecycle logs events without credentials or bearer tokens", async () => {
	const output: string[] = [];
	const logger = pino(
		{ level: "trace" },
		{
			write(line) {
				output.push(line);
			},
		},
	);
	const { app, password, dataDir } = await application("", false, logger);
	const credential = JSON.parse(
		await readFile(join(dataDir, "auth.json"), "utf8"),
	);
	const first = await browser(app, password ?? "");
	const wrongPassword = "wrong-password-secret-marker";
	const rejected = await app.inject({
		url: "/api/auth/login",
		method: "POST",
		headers: { ...headers, cookie: first.cookie, "x-csrf-token": first.csrf },
		payload: { password: wrongPassword },
	});
	expect(rejected.statusCode).toBe(401);
	const link = (
		await app.inject({
			url: "/api/media/file/access-link",
			method: "POST",
			headers: { ...headers, cookie: first.cookie, "x-csrf-token": first.csrf },
		})
	).json().url;
	const mediaToken =
		new URL(link, "http://localhost").searchParams.get("access_token") ?? "";
	expect(
		(
			await app.inject({
				url: "/api/auth/logout",
				method: "POST",
				headers: {
					...headers,
					cookie: first.cookie,
					"x-csrf-token": first.csrf,
				},
			})
		).statusCode,
	).toBe(204);
	const second = await browser(app, password ?? "");
	const newPassword = "changed-password-secret-marker";
	const change = (currentPassword: string) =>
		app.inject({
			url: "/api/auth/password",
			method: "PUT",
			headers: {
				...headers,
				cookie: second.cookie,
				"x-csrf-token": second.csrf,
			},
			payload: { currentPassword, password: newPassword },
		});
	expect((await change(wrongPassword)).statusCode).toBe(401);
	expect((await change(password ?? "")).statusCode).toBe(204);
	const records = output.map((line) => JSON.parse(line));
	for (const [event, level] of [
		["auth.credentials_initialized", 30],
		["auth.login_succeeded", 30],
		["auth.login_failed", 40],
		["auth.logout_succeeded", 30],
		["auth.password_change_rejected", 40],
		["auth.password_changed", 30],
	] as const)
		expect(records).toContainEqual(expect.objectContaining({ event, level }));
	expect(
		records
			.filter((record) => record.event === "auth.login_succeeded")
			.map((record) => record.reqId),
	).toEqual([
		first.login.headers["x-request-id"],
		second.login.headers["x-request-id"],
	]);
	const text = output.join("");
	for (const secret of [
		password,
		wrongPassword,
		newPassword,
		first.csrf,
		second.csrf,
		first.login.cookies[0]?.value,
		mediaToken,
		credential.hash,
		credential.salt,
	]) {
		expect(secret).toBeTruthy();
		expect(text).not.toContain(secret);
	}
	expect(
		records.find((record) => record.event === "auth.login_succeeded").reqId,
	).toBeTruthy();
});

test("session storage diagnostics retain error code and operation without SQL parameters", async () => {
	const output: string[] = [];
	const logger = pino(
		{ level: "trace" },
		{
			write(line) {
				output.push(line);
			},
		},
	);
	const { app, database, dataDir } = await application("", false, logger);
	const secret = "injected-session-secret-marker";
	vi.spyOn(database.authentication, "saveSession").mockImplementation(() => {
		throw new Error(`SQL parameters: ${secret}`, {
			cause: Object.assign(new Error(secret), { code: "SQLITE_READONLY" }),
		});
	});
	const response = await app.inject({ url: "/api/auth/session", headers });
	expect(response.statusCode).toBe(500);
	const records = output.map((line) => JSON.parse(line));
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "auth.session_store_failed",
			level: 50,
			operation: "save_session",
			errorType: "Error",
			errorCode: "SQLITE_READONLY",
			path: join(dataDir, "anishelf.sqlite"),
		}),
	);
	expect(output.join("")).not.toContain(secret);
	expect(response.body).not.toContain(secret);
});

test("credential read and write failures include safe paths and diagnostics", async () => {
	const output: string[] = [];
	const logger = pino(
		{ level: "trace" },
		{
			write(line) {
				output.push(line);
			},
		},
	);
	const { app, password, dataDir, database } = await application(
		"",
		false,
		logger,
	);
	const { cookie, csrf } = await browser(app, password ?? "");
	await rm(join(dataDir, "auth.json"));
	const { mkdir } = await import("node:fs/promises");
	await mkdir(join(dataDir, "auth.json"));
	const response = await app.inject({
		url: "/api/auth/password",
		method: "PUT",
		headers: { ...headers, cookie, "x-csrf-token": csrf },
		payload: {
			currentPassword: password,
			password: "next-password-secret-marker",
		},
	});
	expect(response.statusCode).toBe(500);
	expect(output.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({
			event: "auth.credentials_write_failed",
			level: 50,
			operation: "replace_credentials",
			path: join(dataDir, "auth.json"),
			errorCode: expect.stringMatching(/^E/),
		}),
	);
	await expect(
		createAuthenticationModule({
			dataDir,
			logger,
			store: database.authentication,
			secure: false,
			sources: { version: async () => "version" },
		}),
	).rejects.toThrow();
	expect(output.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({
			event: "auth.credentials_load_failed",
			level: 50,
			credentialPath: join(dataDir, "auth.json"),
			sessionKeyPath: join(dataDir, "auth-session.key"),
		}),
	);
	expect(output.join("")).not.toContain(password);
	expect(output.join("")).not.toContain("next-password-secret-marker");
});

test("configured container proxy establishes an HTTPS session and retains Origin/CSRF boundaries", async () => {
	const { app, password } = await application(
		"",
		true,
		pino({ enabled: false }),
		["loopback", "10.89.0.0/24"],
	);
	const proxyHeaders = {
		host: "example.com",
		"x-forwarded-proto": "https",
		origin: "https://example.com",
	};
	const init = await app.inject({
		url: "/api/auth/session",
		headers: proxyHeaders,
		remoteAddress: "10.89.0.2",
	});
	expect(init.statusCode).toBe(200);
	expect(init.headers["set-cookie"]).toContain("Secure");
	expect(init.headers["set-cookie"]).toContain("HttpOnly");
	const cookie = init.cookies
		.map((item) => `${item.name}=${encodeURIComponent(item.value)}`)
		.join("; ");
	const loginHeaders = {
		...proxyHeaders,
		cookie,
		"x-csrf-token": init.json().csrfToken,
	};
	for (const bad of [
		{ origin: "https://evil.example" },
		{ "x-csrf-token": "forged" },
		{ "sec-fetch-site": "cross-site" },
	]) {
		const rejected = await app.inject({
			method: "POST",
			url: "/api/auth/login",
			remoteAddress: "10.89.0.2",
			headers: { ...loginHeaders, ...bad },
			payload: { password },
		});
		expect(rejected.statusCode).toBe(403);
	}
	const login = await app.inject({
		method: "POST",
		url: "/api/auth/login",
		remoteAddress: "10.89.0.2",
		headers: loginHeaders,
		payload: { password },
	});
	expect(login.statusCode, login.body).toBe(200);
	expect(login.headers["set-cookie"]).toContain("Secure");
	const rotated = login.cookies
		.map((item) => `${item.name}=${encodeURIComponent(item.value)}`)
		.join("; ");
	expect(rotated).not.toBe(cookie);
	const authenticated = await app.inject({
		url: "/api/settings",
		remoteAddress: "10.89.0.2",
		headers: { ...proxyHeaders, cookie: rotated },
	});
	expect(authenticated.statusCode).toBe(200);
	const outside = await app.inject({
		url: "/api/auth/session",
		remoteAddress: "10.90.0.2",
		headers: proxyHeaders,
	});
	expect(outside.headers["set-cookie"]).toBeUndefined();
});

test("missing HTTPS transport trust logs an actionable warning without secrets", async () => {
	const lines: string[] = [];
	const logger = pino(
		{ level: "warn" },
		{
			write: (line) => {
				lines.push(line);
			},
		},
	);
	const { app } = await application("", true, logger);
	await app.inject({
		url: "/api/auth/session",
		remoteAddress: "10.89.0.2",
		headers: { host: "example.com", "x-forwarded-proto": "https" },
	});
	expect(lines.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({ event: "auth.session_transport_untrusted" }),
	);
});
