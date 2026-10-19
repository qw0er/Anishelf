import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import pino from "pino";
import { afterEach, expect, test } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createHttpApp } from "../src/app/bootstrap/http.js";
import { builtinPolicy } from "../src/app/policy.js";
import { createAcquisitionModule } from "../src/modules/acquisition/create.js";
import { parseDeploymentConfig } from "../src/modules/system/configuration/infrastructure/deployment.js";
import { PersistentConfiguration } from "../src/modules/system/configuration/infrastructure/persistent.js";
import {
	createAuthenticationModule,
	createSystemModule,
} from "../src/modules/system/create.js";
import { registerSystemHttp } from "../src/modules/system/http.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
const headers = { host: "127.0.0.1:3000" };

async function fixture(withUpstream = true) {
	const dataDir = await mkdtemp(join(tmpdir(), "anishelf-qbt-"));
	cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
	const upstream = Fastify();
	upstream.addContentTypeParser(
		"*",
		{ parseAs: "buffer" },
		(_request, body, done) => done(null, body),
	);
	upstream.all("/*", async (request, reply) => {
		if (request.url === "/redirect")
			return reply.header("location", "/login").code(302).send();
		if (request.url === "/external")
			return reply
				.header("location", "https://other.example/")
				.code(302)
				.send();
		if (request.url === "/cookie")
			return reply
				.header("set-cookie", [
					"SID=upstream123; Path=/; Domain=internal; HttpOnly",
					"anishelf_session=evil; Path=/",
				])
				.send("ok");
		return {
			url: request.url,
			headers: request.headers,
			body: Buffer.isBuffer(request.body)
				? request.body.toString()
				: request.body,
		};
	});
	const address = withUpstream
		? await upstream.listen({ host: "127.0.0.1", port: 0 })
		: undefined;
	cleanup.push(() => upstream.close());
	const database = ApplicationDatabase.open(dataDir);
	const logger = pino({ enabled: false });
	const auth = await createAuthenticationModule({
		logger,
		dataDir,
		store: database.authentication,
		secure: false,
		sources: { version: async () => "one" },
	});
	const system = await createSystemModule({ ANISHELF_DATA_DIR: dataDir });
	const integration = createAcquisitionModule({
		logger,
		settings: () => system.api.settings,
		upstream: address,
		secure: false,
	});
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		policy: builtinPolicy,
		configure: auth.registerHttp,
		registrations: [
			integration.registerHttp,
			(app) =>
				registerSystemHttp(app, system.api, {
					applySettingsChange: (patch, save) => save(patch),
				}),
		],
		closeDependencies: async () => database.close(),
	});
	cleanup.push(() => app.close());
	await app.ready();
	const session = await app.inject({ url: "/api/auth/session", headers });
	const token = session.json().csrfToken as string;
	const login = await app.inject({
		method: "POST",
		url: "/api/auth/login",
		headers: {
			...headers,
			cookie: session.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
			"x-csrf-token": token,
		},
		payload: { password: auth.initialPassword },
	});
	expect(login.statusCode).toBe(200);
	const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
	return {
		app,
		upstream,
		dataDir,
		headers: { ...headers, cookie },
		csrf: login.json().csrfToken as string,
	};
}

test("protects the page, assets and API with Anishelf authentication", async () => {
	const { app } = await fixture(false);
	for (const url of [
		"/integrations/qbittorrent",
		"/integrations/qbittorrent/",
		"/integrations/qbittorrent/app.js",
		"/integrations/qbittorrent/api/v2/app/version",
	]) {
		expect((await app.inject({ url, headers })).statusCode).toBe(401);
	}
});

test("strips the prefix, preserves queries and streams multipart requests with isolated cookies", async () => {
	const f = await fixture();
	const response = await f.app.inject({
		method: "POST",
		url: "/integrations/qbittorrent/api/v2/torrents/add?x=1",
		headers: {
			...f.headers,
			cookie: `${f.headers.cookie}; anishelf_qbt_sid=upstream123; unrelated=secret`,
			origin: "http://127.0.0.1:3000",
			referer: "http://127.0.0.1:3000/integrations/qbittorrent/",
			authorization: "Bearer secret",
			"x-forwarded-for": "1.2.3.4",
			"content-type": "multipart/form-data; boundary=test",
		},
		payload:
			'--test\r\nContent-Disposition: form-data; name="urls"\r\n\r\nmagnet:example\r\n--test--\r\n',
	});
	expect(response.statusCode).toBe(200);
	const result = response.json();
	expect(result.url).toBe("/api/v2/torrents/add?x=1");
	expect(result.body).toContain("magnet:example");
	expect(result.headers.cookie).toBe("SID=upstream123");
	expect(result.headers.authorization).toBeUndefined();
	expect(result.headers["x-forwarded-for"]).toBeUndefined();
	expect(result.headers.origin).toBe(`http://${result.headers.host}`);
	expect(result.headers.referer).toBe(`http://${result.headers.host}/`);
});

test("rejects cross-site and missing-origin writes before forwarding", async () => {
	const f = await fixture();
	for (const extra of [
		{},
		{ origin: "https://evil.example" },
		{ referer: "https://evil.example/" },
		{ origin: "http://127.0.0.1:3000", "sec-fetch-site": "cross-site" },
	]) {
		expect(
			(
				await f.app.inject({
					method: "POST",
					url: "/integrations/qbittorrent/api/v2/app/shutdown",
					headers: { ...f.headers, ...extra },
				})
			).statusCode,
		).toBe(403);
	}
});

test("scopes and renames upstream cookies and constrains redirects", async () => {
	const f = await fixture();
	const cookie = await f.app.inject({
		url: "/integrations/qbittorrent/cookie",
		headers: f.headers,
	});
	expect(cookie.headers["set-cookie"]).toEqual([
		"anishelf_qbt_sid=upstream123; HttpOnly; Path=/integrations/qbittorrent/; SameSite=Strict",
	]);
	expect(cookie.headers["cache-control"]).toBe("no-store");
	const redirect = await f.app.inject({
		url: "/integrations/qbittorrent/redirect",
		headers: f.headers,
	});
	expect(redirect.headers.location).toBe("/integrations/qbittorrent/login");
	expect(
		(
			await f.app.inject({
				url: "/integrations/qbittorrent",
				headers: f.headers,
			})
		).headers.location,
	).toBe("/integrations/qbittorrent/");
	expect(
		(
			await f.app.inject({
				url: "/integrations/qbittorrent/external",
				headers: f.headers,
			})
		).statusCode,
	).toBe(502);
});

test("Configuration persists the browser URL and Acquisition only exposes derived navigation", async () => {
	const f = await fixture(false);
	const save = (payload: object) =>
		f.app.inject({
			method: "PUT",
			url: "/api/settings",
			headers: { ...f.headers, "x-csrf-token": f.csrf },
			payload,
		});
	const navigation = async () =>
		(
			await f.app.inject({
				url: "/api/integrations/qbittorrent",
				headers: f.headers,
			})
		).json();
	for (const qbittorrentWebUiUrl of [
		"javascript:alert(1)",
		"/internal",
		"https://user:pass@example.com/",
	])
		expect((await save({ qbittorrentWebUiUrl })).statusCode).toBe(400);
	const saved = await save({
		qbittorrentWebUiUrl: "https://downloads.example.com/qbt/",
	});
	expect(saved.statusCode).toBe(200);
	expect(saved.json()).toEqual({
		resourceRoots: [],
		qbittorrentWebUiUrl: "https://downloads.example.com/qbt/",
	});
	expect(await navigation()).toEqual({
		url: "https://downloads.example.com/qbt/",
		proxyConfigured: false,
	});
	expect(
		JSON.parse(await readFile(join(f.dataDir, "settings.json"), "utf8")),
	).toEqual({
		resourceRoots: [],
		qbittorrentWebUiUrl: "https://downloads.example.com/qbt/",
	});
	expect(
		(await PersistentConfiguration.load(f.dataDir)).settings
			.qbittorrentWebUiUrl,
	).toBe("https://downloads.example.com/qbt/");
	await expect(
		readFile(join(f.dataDir, "qbittorrent.json")),
	).rejects.toMatchObject({ code: "ENOENT" });
	expect(
		(await save({ qbittorrentWebUiUrl: " " })).json().qbittorrentWebUiUrl,
	).toBeNull();
	expect((await navigation()).url).toBe("/integrations/qbittorrent/");
	expect(
		(await save({ qbittorrentWebUiUrl: null })).json().qbittorrentWebUiUrl,
	).toBeNull();
	expect((await save({ transcodeCacheBudgetGiB: 12 })).json()).toMatchObject({
		qbittorrentWebUiUrl: null,
		transcodeCacheBudgetGiB: 12,
	});
	expect(
		(
			await f.app.inject({
				method: "PUT",
				url: "/api/integrations/qbittorrent",
				headers: { ...f.headers, "x-csrf-token": f.csrf },
				payload: { webUiUrl: "https://other.example/" },
			})
		).statusCode,
	).toBe(404);
	expect(
		(
			await f.app.inject({
				url: "/integrations/qbittorrent/",
				headers: f.headers,
			})
		).statusCode,
	).toBe(503);
});

test("reports upstream outages without leaking its address", async () => {
	const f = await fixture();
	await f.upstream.close();
	const response = await f.app.inject({
		url: "/integrations/qbittorrent/",
		headers: f.headers,
	});
	expect(response.statusCode).toBe(502);
	expect(response.body).toContain("Check the configured endpoint");
});

test("validates the private upstream independently of the public WebUI URL", () => {
	expect(
		parseDeploymentConfig({
			ANISHELF_QBITTORRENT_URL: "http://qbittorrent:8080/",
		}).qbittorrentUrl,
	).toBe("http://qbittorrent:8080");
	for (const value of [
		"",
		" http://qbittorrent:8080",
		"http://qbt/../",
		"file:///tmp/qbt",
		"https://user:pass@example.com",
		"http://qbt/api",
		"http://qbt?token=secret",
	])
		expect(() =>
			parseDeploymentConfig({ ANISHELF_QBITTORRENT_URL: value }),
		).toThrow("ANISHELF_QBITTORRENT_URL");
});
