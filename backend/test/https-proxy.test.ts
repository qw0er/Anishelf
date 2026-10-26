// Opt-in real-process regression: TLS terminates at an outer Caddy, while the
// packaged Web Caddy and Backend communicate over HTTP. Requires localhost sockets.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { expect, test } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createHttpApp } from "../src/app/bootstrap/http.js";
import { createAuthenticationModule } from "../src/modules/system/create.js";

async function port() {
	const server = createServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing test port");
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}

test.skipIf(!process.env.ANISHELF_TEST_CADDY_BIN)(
	"real TLS -> packaged Web -> HTTP Backend supports Secure session login",
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "anishelf-proxy-"));
		const database = ApplicationDatabase.openMemory();
		const logger = pino({ enabled: false });
		const webPort = await port(),
			outerPort = await port();
		const origin = `https://localhost:${outerPort}`;
		const auth = await createAuthenticationModule({
			dataDir: directory,
			logger,
			secure: true,
			store: database.authentication,
			sources: { version: async () => "v1" },
		});
		const app = createHttpApp({
			config: {
				host: "127.0.0.1",
				port: 3000,
				publicOrigin: origin,
				trustedProxies: ["127.0.0.1/32"],
			},
			logger,
			configure: auth.registerHttp,
			registrations: [],
			closeDependencies: async () => database.close(),
		});
		const observed: object[] = [];
		app.addHook("onRequest", async (request) => {
			observed.push({
				protocol: request.protocol,
				remoteAddress: request.raw.socket.remoteAddress,
				forwardedProto: request.headers["x-forwarded-proto"],
			});
		});
		const children: ReturnType<typeof spawn>[] = [];
		let logs = "";
		try {
			const backendUrl = await app.listen({ port: 0, host: "127.0.0.1" });
			const web = (
				await readFile(
					new URL("../../package/Caddyfile", import.meta.url),
					"utf8",
				)
			)
				.replace(":8080 {", `:${webPort} {`)
				.replace("backend:3000", backendUrl);
			const outer = `{\nadmin off\nskip_install_trust\nauto_https disable_redirects\n}\n${origin} {\ntls internal\nreverse_proxy 127.0.0.1:${webPort}\n}\n`;
			for (const [name, config] of [
				["web", web],
				["outer", outer],
			] as const) {
				const path = join(directory, `${name}.Caddyfile`);
				await writeFile(path, config);
				const child = spawn(
					process.env.ANISHELF_TEST_CADDY_BIN ?? "caddy",
					["run", "--config", path, "--adapter", "caddyfile"],
					{
						env: {
							...process.env,
							HOME: directory,
							XDG_DATA_HOME: join(directory, "data"),
							XDG_CONFIG_HOME: join(directory, "config"),
							ANISHELF_PUBLIC_ORIGIN: origin,
						},
						stdio: ["ignore", "pipe", "pipe"],
					},
				);
				children.push(child);
				child.on("error", (error) => {
					logs += String(error);
				});
				child.stdout?.on("data", (chunk) => {
					logs += chunk;
				});
				child.stderr?.on("data", (chunk) => {
					logs += chunk;
				});
			}
			function send(
				method = "GET",
				headers: Record<string, string> = {},
				payload?: object,
			) {
				return new Promise<{ status: number; cookie: string[]; body: string }>(
					(resolve, reject) => {
						const req = request(
							{
								hostname: "127.0.0.1",
								servername: "localhost",
								port: outerPort,
								path:
									method === "GET" ? "/api/auth/session" : "/api/auth/login",
								method,
								rejectUnauthorized: false,
								headers: {
									host: `localhost:${outerPort}`,
									origin,
									"content-type": "application/json",
									...headers,
								},
							},
							(response) => {
								let body = "";
								response.on("data", (chunk) => {
									body += chunk;
								});
								response.on("end", () =>
									resolve({
										status: response.statusCode ?? 0,
										cookie: response.headers["set-cookie"] ?? [],
										body,
									}),
								);
							},
						);
						req.on("error", reject);
						req.setTimeout(1000, () =>
							req.destroy(new Error("Proxy request timed out")),
						);
						req.end(payload ? JSON.stringify(payload) : undefined);
					},
				);
			}
			let session: Awaited<ReturnType<typeof send>> | undefined;
			for (let attempt = 0; attempt < 50; attempt++) {
				try {
					session = await send("GET", { "x-forwarded-proto": "http" });
					if (session.status === 200) break;
				} catch {
					/* Wait for the two local proxies and internal TLS certificate. */
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			expect(session?.status, logs).toBe(200);
			if (!session) throw new Error(logs);
			expect(session.cookie[0], JSON.stringify(observed)).toContain("Secure");
			const cookie = session.cookie
				.map((value) => value.split(";")[0])
				.join("; ");
			const login = await send(
				"POST",
				{ cookie, "x-csrf-token": JSON.parse(session.body).csrfToken },
				{ password: auth.initialPassword },
			);
			expect(login.status, login.body).toBe(200);
			expect(login.cookie[0]).toContain("Secure");
			expect(JSON.parse(login.body).authenticated).toBe(true);
			const signedIn = await send("GET", {
				cookie: login.cookie.map((value) => value.split(";")[0]).join("; "),
			});
			expect(JSON.parse(signedIn.body).authenticated).toBe(true);
		} finally {
			await Promise.all(
				children.map(async (child) => {
					if (child.exitCode !== null) return;
					const exited = once(child, "exit");
					child.kill("SIGTERM");
					await exited;
				}),
			);
			await app.close();
			await rm(directory, { recursive: true, force: true });
		}
	},
	20000,
);
