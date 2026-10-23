import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { JackettBootstrapStateFile } from "../src/modules/acquisition/sources/jackett/bootstrap-state.js";
import { BundledJackett } from "../src/modules/acquisition/sources/jackett/bundled.js";
import { JackettConfigurationFile } from "../src/modules/acquisition/sources/jackett/configuration.js";
import { JackettConnection } from "../src/modules/acquisition/sources/jackett/connection.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-jackett-native-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const logger = pino({ level: "silent" });
	const file = join(directory, "ServerConfig.json");
	const state = new JackettBootstrapStateFile(directory);
	const request = vi.fn<typeof fetch>(async (input, init) => {
		const url = String(input);
		if (url.includes("UI/Login"))
			return new Response(null, {
				status: 302,
				headers: { "Set-Cookie": "Jackett=private-cookie; HttpOnly" },
			});
		expect(new Headers(init?.headers).get("Cookie")).toBe(
			"Jackett=private-cookie",
		);
		if (init?.method === "POST") return new Response(null, { status: 204 });
		return Response.json([]);
	});
	const open = async () => {
		const connection = new JackettConnection(
			new JackettConfigurationFile(directory),
			() => {
				throw new Error("No Torznab client during bootstrap");
			},
			logger,
		);
		await connection.initialize();
		cleanup.push(() => connection.close());
		const bootstrap = new BundledJackett({
			path: file,
			dataDir: directory,
			connection,
			logger,
			request,
		});
		cleanup.push(() => bootstrap.close());
		return { connection, bootstrap };
	};
	return {
		directory,
		logger,
		file,
		state,
		request,
		open,
		write: (AdminPassword = "") =>
			writeFile(
				file,
				JSON.stringify({ APIKey: "private-key", AdminPassword, Port: 9117 }),
				{ mode: 0o600 },
			),
	};
}
async function fresh(f: Awaited<ReturnType<typeof fixture>>) {
	const waiting = await f.open();
	waiting.bootstrap.start();
	await vi.waitFor(async () =>
		expect((await f.state.read())?.phase).toBe("waiting"),
	);
	await waiting.bootstrap.close();
	await f.write();
	const active = await f.open();
	active.bootstrap.start();
	return active;
}

test("Jackett owns native config; fresh setup imports a private key and configures a site once", async () => {
	const f = await fixture();
	const first = await fresh(f);
	await vi.waitFor(() => expect(first.bootstrap.setup).toBe("complete"));
	expect(first.connection.settings()).toMatchObject({
		origin: "bundled",
		hasApiKey: true,
		indexers: ["nyaasi"],
	});
	expect(JSON.stringify(first.connection.settings())).not.toContain(
		"private-key",
	);
	expect(JSON.parse(await readFile(f.file, "utf8"))).toEqual({
		APIKey: "private-key",
		AdminPassword: "",
		Port: 9117,
	});
	expect(
		(await stat(join(f.directory, "acquisition/jackett-bootstrap.json"))).mode &
			0o777,
	).toBe(0o600);
	await first.bootstrap.close();
	f.request.mockClear();
	const reopened = await f.open();
	reopened.bootstrap.start();
	await vi.waitFor(() => expect(reopened.bootstrap.setup).toBe("complete"));
	// Even if the site has been deleted, a restart never writes to management again.
	expect(f.request).not.toHaveBeenCalled();
});

test("existing native config is imported without changing sites; disconnect persists and explicit selection restores only the connection", async () => {
	const f = await fixture();
	await f.write();
	const first = await f.open();
	first.bootstrap.start();
	await vi.waitFor(() =>
		expect(first.connection.settings().origin).toBe("bundled"),
	);
	expect(first.bootstrap.setup).toBe("manual");
	expect(f.request).not.toHaveBeenCalled();
	await first.connection.clear(first.connection.settings().generation);
	await first.bootstrap.close();
	const reopened = await f.open();
	reopened.bootstrap.start();
	await vi.waitFor(() => expect(reopened.bootstrap.available).toBe(true));
	expect(reopened.connection.settings().origin).toBeNull();
	await reopened.bootstrap.activate(reopened.connection.settings().generation);
	expect(reopened.connection.settings().origin).toBe("bundled");
	await expect(
		reopened.bootstrap.activate("stale-generation"),
	).rejects.toMatchObject({ code: "source_conflict" });
});

test("external connections survive delayed native configuration and no site is modified", async () => {
	const f = await fixture();
	await f.state.write({ version: 1, phase: "waiting", instance: null });
	await f.write();
	const active = await f.open();
	await active.connection.save({
		generation: active.connection.settings().generation,
		url: "http://external:9117",
		apiKey: "external-secret",
		origin: "external",
		indexers: [],
	});
	const saved = active.connection.settings();
	active.bootstrap.start();
	await vi.waitFor(() => expect(active.bootstrap.available).toBe(true));
	await active.bootstrap.close();
	expect(active.connection.settings()).toEqual(saved);
	expect(f.request).not.toHaveBeenCalled();
});

test("an uncertain management write is journaled before dispatch and never repeated", async () => {
	const f = await fixture();
	const original = f.request.getMockImplementation();
	f.request.mockImplementation(async (input, init) => {
		if (init?.method === "POST") {
			expect((await f.state.read())?.phase).toBe("attempted");
			throw new Error("Lost private response");
		}
		if (!original) throw new Error("Missing request mock");
		return original(input, init);
	});
	const first = await fresh(f);
	await vi.waitFor(async () =>
		expect((await f.state.read())?.phase).toBe("attempted"),
	);
	await first.bootstrap.close();
	f.request.mockClear();
	const reopened = await f.open();
	reopened.bootstrap.start();
	await vi.waitFor(async () =>
		expect((await f.state.read())?.phase).toBe("manual"),
	);
	expect(f.request).not.toHaveBeenCalled();
});

test("an administrator password requires manual site setup", async () => {
	const f = await fixture();
	await f.state.write({ version: 1, instance: null, phase: "waiting" });
	await f.write("password-hash");
	const active = await f.open();
	active.bootstrap.start();
	await vi.waitFor(() => expect(active.bootstrap.setup).toBe("manual"));
	expect(active.connection.settings().origin).toBe("bundled");
	expect(f.request).not.toHaveBeenCalled();
});

test("changing connections aborts management requests before a site write; shutdown drains the worker", async () => {
	const f = await fixture();
	f.request.mockImplementation(
		(_input, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => reject(init.signal?.reason),
					{ once: true },
				);
			}),
	);
	const active = await fresh(f);
	await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
	await active.connection.clear(active.connection.settings().generation);
	await active.bootstrap.close();
	expect((await f.state.read())?.phase).toBe("pending");
	expect(f.request).toHaveBeenCalledTimes(1);
});

test("changing the service address requires an explicit key and management URLs reject credentials", async () => {
	const f = await fixture();
	const { connection } = await f.open();
	await connection.save({
		generation: connection.settings().generation,
		url: "http://external:9117",
		apiKey: "secret",
		origin: "external",
		indexers: ["nyaasi"],
	});
	const generation = connection.settings().generation;
	await expect(
		connection.save({
			generation,
			url: "http://other:9117",
			origin: "external",
			indexers: [],
		}),
	).rejects.toMatchObject({ code: "invalid_configuration" });
	await expect(
		connection.save({
			generation,
			url: "http://external:9117",
			managementUrl: "https://user:password@example.org",
			origin: "external",
			indexers: [],
		}),
	).rejects.toThrow();
	expect(connection.settings().generation).toBe(generation);
});

test("completed installation key rotation never overwrites saved credentials or reconfigures sites", async () => {
	const f = await fixture();
	const first = await fresh(f);
	await vi.waitFor(() => expect(first.bootstrap.setup).toBe("complete"));
	await first.bootstrap.close();
	const saved = first.connection.settings();
	await writeFile(f.file, JSON.stringify({ APIKey: "rotated-secret" }));
	f.request.mockClear();
	const reopened = await f.open();
	reopened.bootstrap.start();
	await vi.waitFor(() => expect(reopened.bootstrap.setup).toBe("manual"));
	expect(reopened.connection.settings()).toEqual(saved);
	expect(f.request).not.toHaveBeenCalled();
	await reopened.bootstrap.activate(saved.generation);
	expect(reopened.connection.settings().generation).not.toBe(saved.generation);
	expect(JSON.stringify(reopened.connection.settings())).not.toContain(
		"rotated-secret",
	);
});

test("an existing configured default site is recognized without writing", async () => {
	const f = await fixture();
	const original = f.request.getMockImplementation();
	f.request.mockImplementation(async (input, init) => {
		if (String(input).includes("?configured=true"))
			return Response.json([{ id: "nyaasi", configured: true }]);
		if (!original) throw new Error("Missing request mock");
		return original(input, init);
	});
	const active = await fresh(f);
	await vi.waitFor(() => expect(active.bootstrap.setup).toBe("complete"));
	expect(f.request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
		false,
	);
});

test("unreadable native configuration does not block startup or replace saved settings", async () => {
	const f = await fixture();
	await writeFile(f.file, '{"APIKey":');
	const active = await f.open();
	const warning = vi.spyOn(f.logger, "warn");
	expect(active.bootstrap.start()).toBeUndefined();
	await vi.waitFor(() => expect(warning).toHaveBeenCalled());
	await active.bootstrap.close();
	expect(active.connection.settings().origin).toBeNull();
	expect(f.request).not.toHaveBeenCalled();
});
