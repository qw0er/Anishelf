import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import pino from "pino";
import { afterEach, expect, test } from "vitest";
import { createQbittorrentClient } from "../src/modules/acquisition/create.js";
import {
	type QbittorrentApi,
	QbittorrentError,
	type QbittorrentOptions,
} from "../src/modules/acquisition/public.js";

const hash = "0123456789abcdef0123456789abcdef01234567";
const torrent = {
	hash,
	name: "episode.mkv",
	state: "stalledDL",
	progress: 0.5,
	amount_left: 50,
	size: 100,
	dlspeed: 12,
	upspeed: 3,
	save_path: "/downloads",
	content_path: "/downloads/episode.mkv",
	category: "anishelf",
	tags: "intent:1, managed",
};
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
type Request = {
	path: string;
	body: string;
	headers: IncomingMessage["headers"];
};
type Handler = (
	request: Request,
	response: ServerResponse,
) => boolean | undefined;
async function fixture(
	handler: Handler = () => false,
	options: Partial<QbittorrentOptions> = {},
) {
	const requests: Request[] = [];
	const logs: string[] = [];
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const chunk of req) body += chunk;
		const request = { path: req.url ?? "", body, headers: req.headers };
		requests.push(request);
		if (handler(request, res) !== false) return;
		switch (request.path.split("?")[0]) {
			case "/qbt/api/v2/auth/login":
				res.setHeader("set-cookie", "SID=session-secret; HttpOnly; Path=/");
				res.end("Ok.");
				break;
			case "/qbt/api/v2/app/version":
				res.end("v5.0.5");
				break;
			case "/qbt/api/v2/app/webapiVersion":
				res.end("2.11.4");
				break;
			case "/qbt/api/v2/app/defaultSavePath":
				res.end("/downloads/");
				break;
			case "/qbt/api/v2/app/preferences":
				res.end(
					JSON.stringify({ temp_path_enabled: true, temp_path: "/incomplete" }),
				);
				break;
			case "/qbt/api/v2/torrents/info":
				res.end(JSON.stringify([torrent]));
				break;
			case "/qbt/api/v2/torrents/files":
				res.end(
					JSON.stringify([
						{
							index: 0,
							name: "episode.mkv",
							size: 100,
							progress: 1,
							priority: 1,
						},
					]),
				);
				break;
			case "/qbt/api/v2/torrents/add":
				res.end("Ok.");
				break;
			default:
				res.end();
		}
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	cleanup.push(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing fixture address.");
	const url = `http://127.0.0.1:${address.port}/qbt/`;
	const client: QbittorrentApi = createQbittorrentClient({
		url,
		username: "user-secret",
		password: "password-secret",
		logger: pino({ level: "debug" }, { write: (line) => logs.push(line) }),
		...options,
	});
	cleanup.push(() => client.close());
	return { client, requests, logs, url };
}

test("SDK cookie login is shared by concurrent operations and preserves proxy prefix", async () => {
	const { client, requests, url } = await fixture();
	const [probe, tasks] = await Promise.all([client.probe(), client.tasks()]);
	expect(probe).toEqual({
		version: "v5.0.5",
		apiVersion: "2.11.4",
		defaultSavePath: "/downloads/",
		incompletePathEnabled: true,
		incompletePath: "/incomplete",
	});
	expect(tasks[0]).toMatchObject({
		hash,
		remainingBytes: 50,
		downloadBytesPerSecond: 12,
		state: "stalledDL",
		tags: ["intent:1", "managed"],
	});
	expect(
		requests.filter((request) => request.path.endsWith("/auth/login")),
	).toHaveLength(1);
	expect(requests[0]?.body).toBe(
		"username=user-secret&password=password-secret",
	);
	for (const request of requests.slice(1)) {
		expect(request.headers.cookie).toBe("SID=session-secret");
		expect(request.headers.referer).toBe(url);
	}
});
test("lookup distinguishes absent task from a failed or invalid snapshot", async () => {
	const { client } = await fixture((request, response) => {
		if (!request.path.includes("/torrents/info")) return false;
		response.end("[]");
	});
	expect(await client.task(hash)).toBeNull();
	expect(await client.files(hash)).toEqual([
		{ index: 0, path: "episode.mkv", sizeBytes: 100, progress: 1, priority: 1 },
	]);
});
test("single lookup checks returned identity and validates snapshots", async () => {
	let body = JSON.stringify([{ ...torrent, hash: "a".repeat(40) }]);
	const { client } = await fixture((request, response) => {
		if (!request.path.includes("/torrents/info")) return false;
		response.end(body);
	});
	await expect(client.task(hash)).rejects.toMatchObject({
		code: "invalid-response",
	});
	body = JSON.stringify([{ ...torrent, progress: 2 }]);
	await expect(client.tasks()).rejects.toMatchObject({
		code: "invalid-response",
	});
	body = "<html>proxy login</html>";
	await expect(client.tasks()).rejects.toMatchObject({
		code: "invalid-response",
	});
});
test("pause/resume initialize version before choosing 5.x endpoints; remove preserves files", async () => {
	const { client, requests } = await fixture();
	await client.pause(hash.toUpperCase());
	await client.resume(hash);
	await client.remove(hash);
	await client.recheck(hash);
	const writes = requests.filter((request) =>
		/\/torrents\//.test(request.path),
	);
	expect(writes.map((request) => request.path)).toEqual([
		"/qbt/api/v2/torrents/stop",
		"/qbt/api/v2/torrents/start",
		"/qbt/api/v2/torrents/delete",
		"/qbt/api/v2/torrents/recheck",
	]);
	expect(writes[0]?.body).toBe(`hashes=${hash}`);
	expect(writes[2]?.body).toBe(`hashes=${hash}&deleteFiles=false`);
});
test("magnet and torrent multipart submissions preserve explicit placement and tags", async () => {
	const { client, requests } = await fixture();
	const common = {
		savePath: "/downloads/anime",
		category: "anishelf",
		tags: ["intent:42"],
		paused: true,
	};
	await client.add({
		...common,
		source: { magnet: `magnet:?xt=urn:btih:${hash}` },
	});
	await client.add({
		...common,
		source: { torrent: new TextEncoder().encode("torrent-fixture") },
	});
	const writes = requests.filter((request) =>
		request.path.endsWith("/torrents/add"),
	);
	expect(writes).toHaveLength(2);
	for (const request of writes) {
		expect(request.body).toContain('name="savepath"\r\n\r\n/downloads/anime');
		expect(request.body).toContain('name="tags"\r\n\r\nintent:42');
		expect(request.body).toContain('name="stopped"\r\n\r\ntrue');
		expect(request.body).toContain('name="useAutoTMM"\r\n\r\nfalse');
	}
	expect(writes[0]?.body).toContain(`magnet:?xt=urn:btih:${hash}`);
	expect(writes[1]?.body).toContain("torrent-fixture");
});
test("server-rejected adds are distinct from unknown delivery and are never retried", async () => {
	const { client, requests } = await fixture((request, response) => {
		if (!request.path.endsWith("/torrents/add")) return false;
		response.end("Fails.");
	});
	await expect(
		client.add({
			source: { magnet: `magnet:?xt=urn:btih:${hash}` },
			savePath: "/downloads",
			category: "anishelf",
			tags: [],
		}),
	).rejects.toMatchObject({ code: "rejected", outcome: "rejected" });
	expect(
		requests.filter((request) => request.path.endsWith("/torrents/add")),
	).toHaveLength(1);
});
test("lost mutation response is unknown and never automatically resent", async () => {
	const { client, requests } = await fixture((request, response) => {
		if (!request.path.endsWith("/torrents/delete")) return false;
		response.destroy();
	});
	await expect(client.remove(hash)).rejects.toMatchObject({
		code: "unavailable",
		outcome: "unknown",
	});
	expect(
		requests.filter((request) => request.path.endsWith("/torrents/delete")),
	).toHaveLength(1);
});
test("login refusal is sanitized and commands remain unsent", async () => {
	const { client, logs, requests } = await fixture((request, response) => {
		if (!request.path.endsWith("/auth/login")) return false;
		response.end("Fails. password-secret");
	});
	await expect(client.pause(hash)).rejects.toMatchObject({
		code: "unauthorized",
		outcome: "not-sent",
	});
	expect(requests).toHaveLength(1);
	expect(logs.join("")).not.toMatch(/user-secret|password-secret|SID|http:/);
});
test("expired session reauthenticates once after an explicit authentication rejection", async () => {
	let rejected = false;
	const { client, requests } = await fixture((request, response) => {
		if (request.path.includes("/torrents/info") && !rejected) {
			rejected = true;
			response.writeHead(403).end();
			return;
		}
		return false;
	});
	expect(await client.tasks()).toHaveLength(1);
	expect(
		requests.filter((request) => request.path.endsWith("/auth/login")),
	).toHaveLength(2);
});
test("unsupported major version blocks mutations", async () => {
	const { client, requests } = await fixture((request, response) => {
		if (!request.path.endsWith("/app/version")) return false;
		response.end("v4.6.7");
	});
	await expect(client.pause(hash)).rejects.toMatchObject({
		code: "unsupported-version",
		outcome: "not-sent",
	});
	expect(requests.some((request) => request.path.includes("/torrents/"))).toBe(
		false,
	);
});
test("redirects are rejected without forwarding credentials", async () => {
	const { client, requests } = await fixture((request, response) => {
		if (!request.path.includes("/torrents/info")) return false;
		response.writeHead(302, { location: "/stolen" }).end();
	});
	await expect(client.tasks()).rejects.toMatchObject({ code: "redirect" });
	expect(requests.some((request) => request.path === "/stolen")).toBe(false);
});
test("oversized and streamed responses fail instead of publishing a partial snapshot", async () => {
	const { client } = await fixture(
		(request, response) => {
			if (!request.path.includes("/torrents/info")) return false;
			response.write("[");
			response.end(" ".repeat(2048));
		},
		{ maximumResponseBytes: 1024 },
	);
	await expect(client.tasks()).rejects.toMatchObject({
		code: "response-too-large",
	});
});
test("operation deadline aborts in-flight writes and retains unknown outcome", async () => {
	const { client } = await fixture(
		(request) => (request.path.endsWith("/torrents/stop") ? undefined : false),
		{ timeoutMs: 150 },
	);
	await expect(client.pause(hash)).rejects.toMatchObject({
		code: "timeout",
		outcome: "unknown",
	});
});
test("caller cancellation and close terminate requests without later reuse", async () => {
	let seen = () => {};
	const { client } = await fixture((request) => {
		if (!request.path.includes("/torrents/info")) return false;
		seen();
	});
	await client.probe();
	const controller = new AbortController();
	const received = new Promise<void>((resolve) => {
		seen = resolve;
	});
	const request = client.tasks(controller.signal);
	const assertion = expect(request).rejects.toMatchObject({
		code: "cancelled",
	});
	await received;
	controller.abort();
	await assertion;
	const secondReceived = new Promise<void>((resolve) => {
		seen = resolve;
	});
	const pending = client.tasks();
	const closed = expect(pending).rejects.toMatchObject({ code: "cancelled" });
	await secondReceived;
	await client.close();
	await closed;
	await expect(client.tasks()).rejects.toMatchObject({ code: "cancelled" });
});
test("invalid endpoint credentials and wildcard hashes are rejected locally", async () => {
	const { client, requests } = await fixture();
	expect(() => client.pause("all")).toThrow(QbittorrentError);
	expect(() => client.remove(`${hash}|${hash}`)).toThrow(QbittorrentError);
	expect(() =>
		client.add({
			source: { magnet: "https://example.org/file.torrent" },
			savePath: "/downloads",
			category: "anishelf",
			tags: [],
		}),
	).toThrow(QbittorrentError);
	expect(requests).toHaveLength(0);
	for (const url of [
		"file:///tmp/api",
		"http://user:secret@localhost",
		"http://localhost/?secret=x",
	]) {
		expect(() =>
			createQbittorrentClient({
				url,
				username: "u",
				password: "p",
				logger: pino({ enabled: false }),
			}),
		).toThrow(QbittorrentError);
	}
});

test("an unrecognized add receipt is unknown; HTTP success alone never proves acceptance", async () => {
	const { client, requests } = await fixture((request, response) => {
		if (!request.path.endsWith("/torrents/add")) return false;
		response.end("<html>login page</html>");
	});
	await expect(
		client.add({
			source: { torrent: new TextEncoder().encode("fixture") },
			savePath: "/downloads",
			category: "anishelf",
			tags: [],
		}),
	).rejects.toMatchObject({ code: "invalid-response", outcome: "unknown" });
	expect(
		requests.filter((request) => request.path.endsWith("/torrents/add")),
	).toHaveLength(1);
});
test("server errors do not retry writes or become authoritative empty snapshots", async () => {
	const { client, requests } = await fixture((request, response) => {
		if (!request.path.includes("/torrents/")) return false;
		response.writeHead(503).end("password-secret");
	});
	await expect(client.remove(hash)).rejects.toMatchObject({
		code: "unavailable",
		outcome: "unknown",
	});
	await expect(client.tasks()).rejects.toMatchObject({
		code: "unavailable",
		outcome: "read",
	});
	expect(
		requests.filter((request) => request.path.includes("/torrents/")),
	).toHaveLength(2);
});
test("pre-cancelled mutations never send even authentication requests", async () => {
	const { client, requests } = await fixture();
	await expect(client.pause(hash, AbortSignal.abort())).rejects.toMatchObject({
		code: "cancelled",
		outcome: "not-sent",
	});
	expect(requests).toHaveLength(0);
});
test("malformed file indexes and compression cannot bypass response validation", async () => {
	let compressed = false;
	const { client } = await fixture((request, response) => {
		if (!request.path.includes("/torrents/files")) return false;
		if (compressed) response.setHeader("content-encoding", "gzip");
		response.end(
			JSON.stringify([{ name: "x.mkv", size: 10, progress: 1, priority: 1 }]),
		);
	});
	await expect(client.files(hash)).rejects.toMatchObject({
		code: "invalid-response",
	});
	compressed = true;
	await expect(client.files(hash)).rejects.toMatchObject({
		code: "invalid-response",
	});
});
