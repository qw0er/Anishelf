import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createHttpApp } from "../src/bootstrap/http.js";

let fixture: string;
let app: ReturnType<typeof createHttpApp>;
const headers = { host: "127.0.0.1:3000" };

beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-static-"));
	const root = join(fixture, "web");
	await mkdir(join(root, "assets"), { recursive: true });
	await writeFile(
		join(root, "index.html"),
		"<!doctype html><title>Anishelf</title>",
	);
	await writeFile(join(root, "assets", "app.js"), "console.log('Anishelf');");
	await writeFile(join(root, ".secret"), "hidden");
	await writeFile(join(fixture, "settings.json"), "private settings");
	app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger: pino({ enabled: false }),
		development: false,
		frontendRoot: root,
	});
});

afterEach(async () => {
	await app.close();
	await rm(fixture, { recursive: true, force: true });
});

test.each(["/", "/directories/example?directory=root", "/files/example"])(
	"serves the SPA entry at %s including HEAD",
	async (url) => {
		const response = await app.inject({ url, headers });
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toContain("text/html");
		expect(response.headers["cache-control"]).toBe("no-cache");
		expect(response.body).toContain("<title>Anishelf</title>");
		const head = await app.inject({ method: "HEAD", url, headers });
		expect(head.statusCode).toBe(200);
		expect(head.body).toBe("");
	},
);

test("serves assets and leaves API responses separate from SPA navigation", async () => {
	const asset = await app.inject({ url: "/assets/app.js", headers });
	expect(asset.statusCode).toBe(200);
	expect(asset.headers["content-type"]).toContain("javascript");
	expect(asset.body).toBe("console.log('Anishelf');");
	expect((await app.inject({ url: "/api/health", headers })).json()).toEqual({
		status: "ok",
	});
	for (const url of ["/api", "/api/missing", "/assets/missing.js"]) {
		const response = await app.inject({
			url,
			headers: { ...headers, accept: "text/html" },
		});
		expect(response.statusCode).toBe(404);
		expect(response.json().error.code).toBe("ROUTE_NOT_FOUND");
	}
	const unknown = await app.inject({
		url: "/unknown",
		headers: { ...headers, accept: "text/html" },
	});
	expect(unknown.statusCode).toBe(200);
});

test("does not expose dotfiles or files outside the frontend directory", async () => {
	for (const url of [
		"/.secret",
		"/%2e%2e/settings.json",
		"/..%2fsettings.json",
	]) {
		const response = await app.inject({ url, headers });
		expect(response.statusCode).toBeGreaterThanOrEqual(400);
		expect(response.body).not.toContain("private settings");
		expect(response.body).not.toContain("hidden");
	}
});

test("fails startup with an actionable message when the frontend was not built", async () => {
	await rm(join(fixture, "web", "index.html"));
	await expect(app.ready()).rejects.toThrow("Run npm run build");
});

test.each([false, undefined])(
	"serves the frontend outside development mode: %s",
	async (development) => {
		await app.close();
		app = createHttpApp({
			config: { host: "127.0.0.1", port: 3000 },
			logger: pino({ enabled: false }),
			...(development === undefined ? {} : { development }),
			frontendRoot: join(fixture, "web"),
		});
		for (const url of ["/", "/files/example", "/assets/app.js"]) {
			const response = await app.inject({ url, headers });
			expect(response.statusCode).toBe(200);
		}
		expect((await app.inject({ url: "/api/health", headers })).statusCode).toBe(
			200,
		);
	},
);

test("starts API-only when no frontend directory is supplied", async () => {
	await app.close();
	app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger: pino({ enabled: false }),
	});
	expect((await app.inject({ url: "/", headers })).statusCode).toBe(404);
	expect((await app.inject({ url: "/api/health", headers })).statusCode).toBe(
		200,
	);
});
