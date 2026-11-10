import type AVPlayerUI from "@libmedia/avplayer-ui";
import FontName from "fontname";

/** Register font attachments already demuxed by the pinned player; no server extraction. */
export async function registerEmbeddedFonts(
	player: Pick<AVPlayerUI, "getStreams">,
): Promise<() => void> {
	const faces: FontFace[] = [];
	const release = () => {
		for (const face of faces) document.fonts.delete(face);
	};
	// libmedia's cheap runtime owns this heap. Keep its version-specific access here.
	const heap = (
		globalThis as typeof globalThis & {
			CHeap?: { Memory?: WebAssembly.Memory };
		}
	).CHeap?.Memory;
	if (!heap || typeof FontFace === "undefined") return release;
	let remaining = 32 * 1024 * 1024;
	let count = 0;
	for (const stream of player.getStreams()) {
		if (stream.mediaType !== "Attachment") continue;
		const mime = String(stream.metadata.mime ?? "").toLowerCase();
		const name = String(stream.metadata.title ?? "");
		if (!/font|opentype|truetype/.test(mime) && !/\.(ttf|otf|ttc)$/i.test(name))
			continue;
		const { extradata, extradataSize: size } = stream.codecparProxy;
		const offset = Number(extradata);
		if (
			count >= 32 ||
			!Number.isSafeInteger(offset) ||
			!Number.isSafeInteger(size) ||
			offset <= 0 ||
			size <= 0 ||
			size > remaining ||
			offset + size > heap.buffer.byteLength
		)
			continue;
		remaining -= size;
		count++;
		try {
			const bytes = new Uint8Array(size);
			bytes.set(new Uint8Array(heap.buffer, offset, size));
			const families = new Set<string>();
			for (const metadata of FontName.parse(bytes.buffer)) {
				// @types/fontname describes older property names; 1.0.1 uses these.
				const font = metadata as typeof metadata & {
					fontFamily?: string;
					fontSubfamily?: string;
				};
				const style = font.fontSubfamily ?? "";
				for (const family of [
					font.fontFamily,
					font.fullName,
					font.postScriptName,
				]) {
					if (!family || families.has(family) || families.size >= 8) continue;
					families.add(family);
					const face = new FontFace(family, bytes, {
						weight: /bold/i.test(style) ? "700" : "400",
						style: /italic|oblique/i.test(style) ? "italic" : "normal",
					});
					await face.load();
					document.fonts.add(face);
					faces.push(face);
				}
			}
		} catch {
			console.warn("[playback] An embedded font could not be registered.", {
				streamIndex: stream.index,
			});
		}
	}
	if (faces.length)
		console.info("[playback] Embedded fonts registered.", {
			count: faces.length,
		});
	return release;
}
