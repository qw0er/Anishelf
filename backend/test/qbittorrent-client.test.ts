import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import pino from "pino";
import { afterEach, expect, test } from "vitest";
import { createQbittorrentClient } from "../src/modules/acquisition/create.js";
import type {
	QbittorrentApi,
	QbittorrentOptions,
} from "../src/modules/acquisition/public.js";

const hash = "0123456789abcdef0123456789abcdef01234567";
const addInput = {
	source: { magnet: `magnet:?xt=urn:btih:${hash}` },
	savePath: "/downloads",
	category: "anishelf",
	tags: [],
};
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
	const { client, requests } = await fixture();
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
	}
});
test("lookup distinguishes absent task from a failed or invalid snapshot", async () => {
	const { client } = await fixture((request, response) => {
		if (!request.path.includes("/torrents/info")) return false;
		response.end("[]");
	});
	expect(await client.task(hash)).toBeNull();
	expect(await client.files(hash)).toEqual([
		{ path: "episode.mkv", sizeBytes: 100, progress: 1, priority: 1 },
	]);
});
test("single lookup checks returned identity", async () => {
	const body = JSON.stringify([{ ...torrent, hash: "a".repeat(40) }]);
	const { client } = await fixture((request, response) => {
		if (!request.path.includes("/torrents/info")) return false;
		response.end(body);
	});
	await expect(client.task(hash)).rejects.toMatchObject({
		code: "invalid-response",
	});
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
		if (!request.path.endsWith("/torrents/add")) return false;
		response.destroy();
	});
	await expect(client.add(addInput)).rejects.toMatchObject({
		code: "unavailable",
		outcome: "unknown",
	});
	expect(
		requests.filter((request) => request.path.endsWith("/torrents/add")),
	).toHaveLength(1);
});
test("login refusal is sanitized and commands remain unsent", async () => {
	const { client, logs, requests } = await fixture((request, response) => {
		if (!request.path.endsWith("/auth/login")) return false;
		response.end("Fails. password-secret");
	});
	await expect(client.add(addInput)).rejects.toMatchObject({
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
	await expect(client.add(addInput)).rejects.toMatchObject({
		code: "unsupported-version",
		outcome: "not-sent",
	});
	expect(requests.some((request) => request.path.includes("/torrents/"))).toBe(
		false,
	);
});
test("SDK request timeout retains unknown mutation outcome", async () => {
	const { client } = await fixture(
		(request) => (request.path.endsWith("/torrents/add") ? undefined : false),
		{ timeoutMs: 150 },
	);
	await expect(client.add(addInput)).rejects.toMatchObject({
		code: "timeout",
		outcome: "unknown",
	});
});
test("cancellation waits for the SDK request; close drains it and blocks reuse", async () => {
	let seen = () => {};
	let respond = () => {};
	const { client, requests } = await fixture((request, response) => {
		if (!request.path.includes("/torrents/info")) return false;
		respond = () => response.end(JSON.stringify([torrent]));
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
	const closing = client.close();
	await expect(client.tasks()).rejects.toMatchObject({ code: "cancelled" });
	respond();
	await assertion;
	await closing;
	expect(
		requests.filter((request) => request.path.includes("/torrents/info")),
	).toHaveLength(1);
});
test("cancelling an in-flight mutation keeps its result unknown without resending", async () => {
	let seen = () => {};
	let respond = () => {};
	const { client, requests } = await fixture((request, response) => {
		if (!request.path.endsWith("/torrents/add")) return false;
		respond = () => response.end();
		seen();
	});
	const controller = new AbortController();
	const received = new Promise<void>((resolve) => {
		seen = resolve;
	});
	const mutation = client.add(addInput, controller.signal);
	const assertion = expect(mutation).rejects.toMatchObject({
		code: "cancelled",
		outcome: "unknown",
	});
	await received;
	controller.abort();
	respond();
	await assertion;
	expect(
		requests.filter((request) => request.path.endsWith("/torrents/add")),
	).toHaveLength(1);
});
test("cancelling one login waiter does not cancel another operation or send its mutation", async () => {
	let seen = () => {};
	let respond = () => {};
	const { client, requests } = await fixture((request, response) => {
		if (!request.path.endsWith("/auth/login")) return false;
		respond = () => {
			response.setHeader("set-cookie", "SID=session-secret; Path=/");
			response.end("Ok.");
		};
		seen();
	});
	const controller = new AbortController();
	const received = new Promise<void>((resolve) => {
		seen = resolve;
	});
	const mutation = client.add(addInput, controller.signal);
	const assertion = expect(mutation).rejects.toMatchObject({
		code: "cancelled",
		outcome: "not-sent",
	});
	await received;
	const tasks = client.tasks();
	controller.abort();
	respond();
	await assertion;
	expect(await tasks).toHaveLength(1);
	expect(
		requests.filter((request) => request.path.endsWith("/auth/login")),
	).toHaveLength(1);
	expect(
		requests.some((request) => request.path.endsWith("/torrents/add")),
	).toBe(false);
});

test("SDK add completion leaves task acceptance to hash reconciliation", async () => {
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
	).resolves.toBeUndefined();
	expect(
		requests.filter((request) => request.path.endsWith("/torrents/add")),
	).toHaveLength(1);
});
test("server errors do not retry writes or become authoritative empty snapshots", async () => {
	const { client, requests } = await fixture((request, response) => {
		if (!request.path.includes("/torrents/")) return false;
		response.writeHead(503).end("password-secret");
	});
	await expect(client.add(addInput)).rejects.toMatchObject({
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
	await expect(client.add(addInput, AbortSignal.abort())).rejects.toMatchObject(
		{
			code: "cancelled",
			outcome: "not-sent",
		},
	);
	expect(requests).toHaveLength(0);
});
