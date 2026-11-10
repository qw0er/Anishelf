import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { downloadAsset } from "./libmedia-download.mjs";

const bytes = Buffer.from("verified WASM fixture");
const item = {
	path: "decode/h264.wasm",
	sha256: createHash("sha256").update(bytes).digest("hex"),
};

test("libmedia downloads", async (t) => {
	t.mock.method(console, "log", () => {});
	t.mock.method(console, "warn", () => {});

	await t.test("downloads and verifies the primary source", async (t) => {
		const fetch = t.mock.method(globalThis, "fetch", async (_url, options) => {
			assert.ok(options.signal instanceof AbortSignal);
			return new Response(bytes);
		});
		assert.deepEqual(await downloadAsset(item, "pinned"), bytes);
		assert.equal(fetch.mock.callCount(), 1);
	});

	await t.test("falls back on 404 and cancels the error body", async (t) => {
		let cancelled = false;
		const calls = [];
		t.mock.method(globalThis, "fetch", async (url, options) => {
			calls.push({ url, options });
			if (calls.length === 1)
				return new Response(
					new ReadableStream({
						cancel() {
							cancelled = true;
						},
					}),
					{ status: 404 },
				);
			return new Response(bytes);
		});
		assert.deepEqual(await downloadAsset(item, "pinned"), bytes);
		assert.equal(cancelled, true);
		assert.equal(calls.length, 2);
		assert.ok(calls[1].url.endsWith("decode/h264.wasm?ref=pinned"));
		assert.equal(
			calls[1].options.headers.Accept,
			"application/vnd.github.raw+json",
		);
	});

	await t.test("retries transient HTTP and body read failures", async (t) => {
		let calls = 0;
		t.mock.method(globalThis, "fetch", async () => {
			calls++;
			if (calls === 1) return new Response(null, { status: 503 });
			if (calls === 2)
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new Error("connection interrupted"));
						},
					}),
				);
			return new Response(bytes);
		});
		assert.deepEqual(await downloadAsset(item, "pinned"), bytes);
		assert.equal(calls, 3);
	});

	await t.test("rejects corrupt content from both sources", async (t) => {
		const fetch = t.mock.method(
			globalThis,
			"fetch",
			async () => new Response("corrupt"),
		);
		await assert.rejects(downloadAsset(item, "pinned"), /checksum mismatch/);
		assert.equal(fetch.mock.callCount(), 2);
	});

	await t.test("bounds network retries for both sources", async (t) => {
		const fetch = t.mock.method(globalThis, "fetch", async () => {
			throw new Error("network unavailable");
		});
		await assert.rejects(
			downloadAsset(item, "pinned"),
			/Unable to download verified libmedia asset.*network unavailable/,
		);
		assert.equal(fetch.mock.callCount(), 6);
	});

	await t.test(
		"allows independent downloads to run concurrently",
		async (t) => {
			let active = 0;
			let peak = 0;
			t.mock.method(globalThis, "fetch", async () => {
				active++;
				peak = Math.max(peak, active);
				await new Promise((resolve) => setImmediate(resolve));
				active--;
				return new Response(bytes);
			});
			await Promise.all(
				Array.from({ length: 4 }, () => downloadAsset(item, "pinned")),
			);
			assert.equal(peak, 4);
		},
	);
});
