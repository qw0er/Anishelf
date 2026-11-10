// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import type AVPlayerUI from "@libmedia/avplayer-ui";
import { afterEach, expect, test, vi } from "vitest";
import { registerEmbeddedFonts } from "../../../src/features/playback/player/fonts.js";

afterEach(() => vi.unstubAllGlobals());

function fixture(
	bytes = readFileSync("../backend/test/fixtures/fonts/fixture.ttf"),
) {
	const memory = new WebAssembly.Memory({ initial: 2 });
	new Uint8Array(memory.buffer, 64, bytes.length).set(bytes);
	vi.stubGlobal("CHeap", { Memory: memory });
	const registered = new Set<unknown>();
	vi.stubGlobal("document", {
		fonts: {
			add: (face: unknown) => registered.add(face),
			delete: (face: unknown) => registered.delete(face),
		},
	});
	class Face {
		constructor(
			readonly family: string,
			readonly bytes: Uint8Array,
		) {}
		async load() {
			return this;
		}
	}
	vi.stubGlobal("FontFace", Face);
	const streams = [
		{
			mediaType: "Attachment",
			index: 4,
			metadata: { title: "fixture.ttf", mime: "application/x-truetype-font" },
			codecparProxy: { extradata: 64, extradataSize: bytes.length },
		},
	];
	const player = {
		getStreams: () => streams,
	} as unknown as Pick<AVPlayerUI, "getStreams">;
	return { player, streams, registered, Face };
}

test("registers internal font names from demuxed bytes and releases them on teardown", async () => {
	const f = fixture();
	const release = await registerEmbeddedFonts(f.player);
	expect(
		[...f.registered].map(
			(face) => (face as InstanceType<typeof f.Face>).family,
		),
	).toContain("Anishelf Fixture");
	release();
	expect(f.registered.size).toBe(0);
});

test("invalid heap ranges and non-font attachments cannot register faces", async () => {
	const f = fixture();
	const stream = f.streams[0];
	if (!stream) throw new Error("Missing attachment fixture");
	stream.codecparProxy.extradataSize = 40 * 1024 * 1024;
	await registerEmbeddedFonts(f.player);
	expect(f.registered.size).toBe(0);
	stream.codecparProxy.extradataSize = 952;
	stream.metadata = { title: "cover.jpg", mime: "image/jpeg" };
	await registerEmbeddedFonts(f.player);
	expect(f.registered.size).toBe(0);
});

test("malformed fonts do not prevent video playback", async () => {
	const f = fixture(Buffer.from("invalid font"));
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		await expect(registerEmbeddedFonts(f.player)).resolves.toBeTypeOf(
			"function",
		);
		expect(f.registered.size).toBe(0);
		expect(warn).toHaveBeenCalled();
	} finally {
		warn.mockRestore();
	}
});
