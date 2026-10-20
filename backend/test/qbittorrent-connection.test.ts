import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createHttpApp } from "../src/app/bootstrap/http.js";
import { builtinPolicy } from "../src/app/policy.js";
import {
	createAcquisitionModule,
	createQbittorrentClient,
} from "../src/modules/acquisition/create.js";
import {
	QbittorrentError,
	type QbittorrentOptions,
} from "../src/modules/acquisition/public.js";
import { createAuthenticationModule } from "../src/modules/system/create.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
const details = {
	url: "http://qbittorrent:8080",
	username: "admin",
	password: "private-qbt-password",
};
const probeResult = {
	version: "v5.0.5",
	apiVersion: "2.11.4",
	defaultSavePath: "/data/media",
	incompletePathEnabled: true,
	incompletePath: "/data/incomplete",
};
async function fixture() {
	const dataDir = await mkdtemp(join(tmpdir(), "anishelf-qbt-connection-"));
	cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
	const logs: string[] = [];
	const logger = pino({ level: "trace" }, { write: (line) => logs.push(line) });
	const calls: QbittorrentOptions[] = [];
	const probe = vi.fn(async () => probeResult);
	const createClient = (options: QbittorrentOptions) => {
		calls.push(options);
		const client = createQbittorrentClient(options);
		vi.spyOn(client, "probe").mockImplementation(probe);
		return client;
	};
	const module = await createAcquisitionModule({
		dataDir,
		logger,
		createClient,
	});
	cleanup.push(() => module.close());
	return {
		dataDir,
		logger,
		logs,
		calls,
		probe,
		module,
		createClient,
		connection: module.api.connection,
		file: join(dataDir, "acquisition", "qbittorrent.json"),
	};
}

test("manual credentials persist privately across restart and never appear in public settings", async () => {
	const f = await fixture();
	expect(f.connection.settings().state).toBe("unconfigured");
	const saved = await f.connection.save({
		...details,
		generation: f.connection.settings().generation,
	});
	expect(saved).toMatchObject({
		state: "configured",
		url: "http://qbittorrent:8080/",
		username: "admin",
		passwordConfigured: true,
	});
	expect(JSON.stringify(saved)).not.toContain(details.password);
	expect((await stat(f.file)).mode & 0o777).toBe(0o600);
	expect((await stat(join(f.dataDir, "acquisition"))).mode & 0o777).toBe(0o700);
	expect(JSON.parse(await readFile(f.file, "utf8")).connection.password).toBe(
		details.password,
	);
	const reopened = await createAcquisitionModule({
		dataDir: f.dataDir,
		logger: f.logger,
		createClient: f.createClient,
	});
	cleanup.push(() => reopened.close());
	expect(reopened.api.connection.settings()).toEqual(saved);
	expect(await reopened.api.connection.probe(saved.generation)).toMatchObject({
		available: true,
		version: "v5.0.5",
	});
	expect(f.calls[0]).toMatchObject({
		url: "http://qbittorrent:8080/",
		username: "admin",
		password: details.password,
	});
	expect(f.logs.join("")).not.toContain(details.password);
});
test("blank password retains the existing credential only for the same endpoint and account", async () => {
	const f = await fixture();
	let saved = await f.connection.save({
		...details,
		generation: f.connection.settings().generation,
	});
	saved = await f.connection.save({
		...details,
		password: "",
		generation: saved.generation,
	});
	await expect(
		f.connection.save({
			...details,
			password: "",
			username: "other",
			generation: saved.generation,
		}),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	await expect(
		f.connection.save({
			...details,
			password: "",
			url: "http://other:8080",
			generation: saved.generation,
		}),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	await f.connection.probe(saved.generation);
	expect(f.calls.at(-1)?.password).toBe(details.password);
	await f.connection.clear(saved.generation);
	expect(f.connection.settings()).toMatchObject({
		state: "unconfigured",
		passwordConfigured: false,
		url: null,
	});
	expect(await readFile(f.file, "utf8")).not.toContain(details.password);
});
test("stale and concurrent saves cannot overwrite newer account credentials", async () => {
	const f = await fixture();
	const generation = f.connection.settings().generation;
	const results = await Promise.allSettled([
		f.connection.save({ ...details, generation }),
		f.connection.save({ ...details, password: "other-password", generation }),
	]);
	expect(results.map((result) => result.status)).toEqual([
		"fulfilled",
		"rejected",
	]);
	await expect(f.connection.clear(generation)).rejects.toMatchObject({
		code: "ACQUISITION_CONFLICT",
	});
	expect(await readFile(f.file, "utf8")).not.toContain("other-password");
});
test("connection checks report authentication failure without losing credentials", async () => {
	const f = await fixture();
	const saved = await f.connection.save({
		...details,
		generation: f.connection.settings().generation,
	});
	f.probe.mockRejectedValueOnce(new QbittorrentError("unauthorized", "read"));
	expect(await f.connection.probe(saved.generation)).toMatchObject({
		available: false,
		code: "unauthorized",
		version: null,
	});
	expect(f.connection.settings()).toEqual(saved);
	expect(f.logs.join("")).not.toContain(details.password);
});
test("a changed configuration invalidates an in-flight connection result", async () => {
	const f = await fixture();
	const saved = await f.connection.save({
		...details,
		generation: f.connection.settings().generation,
	});
	let release = () => {};
	f.probe.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = () => resolve(probeResult);
			}),
	);
	const pending = f.connection.probe(saved.generation);
	const assertion = expect(pending).rejects.toMatchObject({
		code: "ACQUISITION_CONFLICT",
	});
	await f.connection.save({
		...details,
		password: "new-password",
		generation: saved.generation,
	});
	release();
	await assertion;
});
test("invalid private configuration does not prevent local startup and can be replaced", async () => {
	const f = await fixture();
	await mkdir(join(f.dataDir, "acquisition"));
	await writeFile(f.file, "malformed-private-qbt-password");
	const reopened = await createAcquisitionModule({
		dataDir: f.dataDir,
		logger: f.logger,
	});
	cleanup.push(() => reopened.close());
	expect(reopened.api.connection.settings().state).toBe("unavailable");
	await reopened.api.connection.save({
		...details,
		generation: reopened.api.connection.settings().generation,
	});
	expect(reopened.api.connection.settings().state).toBe("configured");
	expect(f.logs.join("")).not.toContain(details.password);
});
test("failed credential publication preserves the previously saved connection", async () => {
	const f = await fixture();
	const saved = await f.connection.save({
		...details,
		generation: f.connection.settings().generation,
	});
	await rm(f.file);
	await mkdir(f.file);
	await expect(
		f.connection.save({
			...details,
			password: "new-password",
			generation: saved.generation,
		}),
	).rejects.toMatchObject({ code: "ACQUISITION_UNAVAILABLE" });
	expect(f.connection.settings()).toEqual(saved);
});
test("authenticated HTTP endpoints enforce CSRF, validate inputs and never echo passwords", async () => {
	const f = await fixture();
	const database = ApplicationDatabase.open(f.dataDir);
	cleanup.push(async () => database.close());
	const auth = await createAuthenticationModule({
		logger: f.logger,
		dataDir: f.dataDir,
		store: database.authentication,
		secure: false,
		sources: { version: async () => "one" },
	});
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger: f.logger,
		policy: builtinPolicy,
		configure: auth.registerHttp,
		registrations: [f.module.registerHttp],
		closeDependencies: async () => {},
	});
	cleanup.push(() => app.close());
	const url = "/api/acquisition/qbittorrent";
	const headers = { host: "127.0.0.1:3000" };
	expect((await app.inject({ url, headers })).statusCode).toBe(401);
	const session = await app.inject({ url: "/api/auth/session", headers });
	const login = await app.inject({
		method: "POST",
		url: "/api/auth/login",
		headers: {
			...headers,
			cookie: session.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
			"x-csrf-token": session.json().csrfToken,
		},
		payload: { password: auth.initialPassword },
	});
	const authenticated = {
		...headers,
		cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
	};
	const mutationHeaders = {
		...authenticated,
		"x-csrf-token": login.json().csrfToken,
	};
	const current = (await app.inject({ url, headers: authenticated })).json();
	expect(
		(
			await app.inject({
				url,
				method: "PUT",
				headers: authenticated,
				payload: { ...details, generation: current.generation },
			})
		).statusCode,
	).toBe(403);
	expect(
		(
			await app.inject({
				url,
				method: "PUT",
				headers: mutationHeaders,
				payload: {
					...details,
					generation: current.generation,
					unexpected: "secret",
				},
			})
		).statusCode,
	).toBe(400);
	const saved = await app.inject({
		url,
		method: "PUT",
		headers: mutationHeaders,
		payload: { ...details, generation: current.generation },
	});
	expect(saved.statusCode).toBe(200);
	expect(saved.body).not.toContain(details.password);
	expect(Object.keys(saved.json())).not.toContain("password");
	const checked = await app.inject({
		url: `${url}/check`,
		method: "POST",
		headers: mutationHeaders,
		payload: { generation: saved.json().generation },
	});
	expect(checked.statusCode).toBe(200);
	expect(checked.json().available).toBe(true);
	expect(checked.body).not.toContain(details.password);
	expect(
		(
			await app.inject({
				url,
				method: "DELETE",
				headers: mutationHeaders,
				payload: { generation: saved.json().generation },
			})
		).json().passwordConfigured,
	).toBe(false);
	expect(f.logs.join("")).not.toContain(details.password);
});
