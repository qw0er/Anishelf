import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createHttpApp } from "../src/app/bootstrap/http.js";
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

async function fixture() {
	const dataDir = await mkdtemp(join(tmpdir(), "anishelf-qbt-"));
	cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
	const database = ApplicationDatabase.openMemory();
	const logger = pino({ enabled: false });
	const auth = await createAuthenticationModule({
		logger,
		dataDir,
		store: database.authentication,

		sources: { version: async () => "one" },
	});
	const system = await createSystemModule({ ANISHELF_DATA_DIR: dataDir });
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		configure: auth.registerHttp,
		registrations: [
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
		dataDir,
		headers: { ...headers, cookie },
		csrf: login.json().csrfToken as string,
	};
}

test("Configuration validates and persists the direct browser URL", async () => {
	const f = await fixture();
	const save = (payload: object) =>
		f.app.inject({
			method: "PUT",
			url: "/api/settings",
			headers: { ...f.headers, "x-csrf-token": f.csrf },
			payload,
		});
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
	).toBe(404);
});

test("removes the proxy pages, assets and API routes", async () => {
	const f = await fixture();
	for (const url of [
		"/integrations/qbittorrent",
		"/integrations/qbittorrent/",
		"/integrations/qbittorrent/app.js",
		"/integrations/qbittorrent/api/v2/app/version",
		"/api/integrations/qbittorrent",
	])
		expect((await f.app.inject({ url, headers: f.headers })).statusCode).toBe(
			404,
		);
});
