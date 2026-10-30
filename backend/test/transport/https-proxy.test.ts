// Opt-in real-process regression: TLS terminates at an outer Caddy, while the
// packaged Web Caddy and Backend communicate over HTTP. Requires localhost sockets.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { expect, test } from "vitest";
import { ApplicationDatabase } from "../../src/app/bootstrap/database.js";
import { createHttpApp } from "../../src/app/bootstrap/http.js";
import { createAuthenticationModule } from "../../src/modules/system/create.js";

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

test.skipIf(!process.env.ANISHELF_TEST_CADDY_BIN).each([
	{ fixedOrigin: false, proxyTrusted: true, defaultPort: "" },
	{ fixedOrigin: true, proxyTrusted: true, defaultPort: "" },
	{ fixedOrigin: false, proxyTrusted: false, defaultPort: "" },
	{ fixedOrigin: true, proxyTrusted: false, defaultPort: "" },
	{ fixedOrigin: true, proxyTrusted: false, defaultPort: "config" },
	{ fixedOrigin: true, proxyTrusted: false, defaultPort: "request" },
])(
	"real TLS -> Web -> Backend (fixed origin: $fixedOrigin, trusted proxy: $proxyTrusted, default port: $defaultPort)",
	async ({ fixedOrigin, proxyTrusted, defaultPort }) => {
		const directory = await mkdtemp(join(tmpdir(), "anishelf-proxy-"));
		const database = ApplicationDatabase.openMemory();
		const logger = pino({ enabled: false });
		const webPort = await port(),
			outerPort = await port();
		const origin = `https://anime.example.com${defaultPort ? "" : `:${outerPort}`}`;
		const requestHost = `anime.example.com${defaultPort === "request" ? ":443" : defaultPort ? "" : `:${outerPort}`}`;
		const auth = await createAuthenticationModule({
			dataDir: directory,
			logger,

			store: database.authentication,
			sources: { version: async () => "v1" },
		});
		const app = createHttpApp({
			config: {
				host: "127.0.0.1",
				port: 3000,
				...(fixedOrigin ? { publicOrigin: origin } : {}),
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
					new URL("../../../package/Caddyfile", import.meta.url),
					"utf8",
				)
			)
				.replace(":8080 {", `:${webPort} {`)
				.replaceAll("backend:3000", backendUrl);
			const outer = `{\nadmin off\nskip_install_trust\nauto_https disable_redirects\n}\nhttps://anime.example.com:${outerPort} {\ntls internal\nreverse_proxy 127.0.0.1:${webPort}\n}\n`;
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
							ANISHELF_PUBLIC_ORIGIN: fixedOrigin
								? `${origin.replace("anime.", "Anime.")}${defaultPort === "config" ? ":443" : ""}/`
								: "",
							ANISHELF_WEB_TRUSTED_PROXIES: proxyTrusted
								? "127.0.0.1/32"
								: "192.0.2.1/32",
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
								servername: "anime.example.com",
								port: outerPort,
								path:
									method === "GET" ? "/api/auth/session" : "/api/auth/login",
								method,
								rejectUnauthorized: false,
								headers: {
									host: requestHost,
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
					if (session.status === 200 || session.status === 400) break;
				} catch {
					/* Wait for the two local proxies and internal TLS certificate. */
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			expect(session?.status, logs).toBe(200);
			if (!session) throw new Error(logs);
			if (!proxyTrusted && !fixedOrigin) {
				expect(session.cookie[0]).not.toContain("Secure");
				const login = await send(
					"POST",
					{
						cookie: session.cookie
							.map((value) => value.split(";")[0])
							.join("; "),
						"x-csrf-token": JSON.parse(session.body).csrfToken,
					},
					{ password: auth.initialPassword },
				);
				expect(login.status).toBe(403);
				expect(JSON.parse(login.body).error.code).toBe(
					"NETWORK_ORIGIN_REJECTED",
				);
				return;
			}
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
			// A declared external HTTPS address must not turn local HTTP cookies Secure.
			async function local(
				method = "GET",
				headers: Record<string, string> = {},
				payload?: object,
			) {
				return new Promise<{ status: number; cookie: string[]; body: string }>(
					(resolve, reject) => {
						const req = httpRequest(
							{
								hostname: "127.0.0.1",
								port: webPort,
								path:
									method === "GET" ? "/api/auth/session" : "/api/auth/login",
								method,
								headers: {
									host: `127.0.0.1:${webPort}`,
									origin: `http://127.0.0.1:${webPort}`,
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
						req.end(payload ? JSON.stringify(payload) : undefined);
					},
				);
			}
			const localSession = await local();
			expect(localSession.status).toBe(200);
			expect(localSession.cookie[0]).not.toContain("Secure");
			const localLogin = await local(
				"POST",
				{
					cookie: localSession.cookie
						.map((value) => value.split(";")[0])
						.join("; "),
					"x-csrf-token": JSON.parse(localSession.body).csrfToken,
				},
				{ password: auth.initialPassword },
			);
			expect(localLogin.status, localLogin.body).toBe(200);
			expect(localLogin.cookie[0]).not.toContain("Secure");
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
