import { createServer } from "node:http";
import { Agent, request } from "undici";
import { afterEach, expect, test } from "vitest";
import { discardBody } from "../../src/modules/acquisition/sources/infrastructure/response-body.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});

test("discarding an unread body never raises an unhandled stream error", async () => {
	const server = createServer((request, response) => {
		switch (request.url) {
			case "/unchanged":
				response.writeHead(304, { etag: '"feed-1"' });
				break;
			case "/moved":
				response.writeHead(302, { location: "/elsewhere" });
				break;
			default:
				response.writeHead(502);
		}
		response.end();
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
	const agent = new Agent({ connections: 1 });
	cleanup.push(() => agent.close());
	const origin = `http://127.0.0.1:${address.port}`;
	for (const path of ["/unchanged", "/moved", "/failure"]) {
		const response = await request(`${origin}${path}`, { dispatcher: agent });
		await discardBody(response);
		expect(response.body.destroyed).toBe(true);
	}
	// An unhandled rejection or stream error would terminate the process here.
	await new Promise((resolve) => setTimeout(resolve, 50));
});
