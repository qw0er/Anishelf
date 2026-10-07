import { subtitleFontConstraints } from "@anishelf/backend/contracts/defaults";
import type { TextTrack } from "@vidstack/react";
import { getSubtitleFonts } from "../../api/client.js";
import type { SubtitlePreparationResponse } from "../../api/contracts.js";
import { boundedSignal } from "../../api/queries.js";

export type SubtitleFonts = NonNullable<SubtitlePreparationResponse["fonts"]>;
export const trackFonts = new WeakMap<TextTrack, SubtitleFonts>();

function delay(signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		signal.throwIfAborted();
		const abort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, 500);
		signal.addEventListener("abort", abort, { once: true });
	});
}
export async function waitForFonts(
	fonts: SubtitleFonts,
	signal: AbortSignal,
): Promise<SubtitleFonts> {
	const waiting = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
	try {
		while (fonts.status === "pending") {
			await delay(waiting);
			fonts = await getSubtitleFonts(fonts.statusUrl, {
				signal: boundedSignal(waiting),
			});
		}
		return fonts;
	} catch {
		signal.throwIfAborted();
		return {
			...fonts,
			status: "degraded",
			assets: [],
			warnings: ["FONT_PREPARATION_FAILED"],
		};
	}
}
/** Download incrementally so unexpected proxy/server payloads cannot bypass memory limits. */
export async function loadFonts(
	fonts: SubtitleFonts | undefined,
	signal: AbortSignal,
): Promise<{ bytes: Uint8Array[]; degraded: boolean }> {
	signal.throwIfAborted();
	const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
	const bytes: Uint8Array[] = [];
	let degraded = fonts?.status === "degraded";
	let total = 0;
	if ((fonts?.assets.length ?? 0) > subtitleFontConstraints.maximumCount)
		degraded = true;
	for (const asset of fonts?.assets.slice(
		0,
		subtitleFontConstraints.maximumCount,
	) ?? []) {
		try {
			if (
				asset.sizeBytes <= 0 ||
				asset.sizeBytes > subtitleFontConstraints.maximumBytes ||
				total + asset.sizeBytes > subtitleFontConstraints.maximumSetBytes
			)
				throw new Error("Font size limit.");
			const response = await fetch(asset.contentUrl, {
				signal: downloadSignal,
			});
			if (!response.ok || !response.body) throw new Error("Font unavailable.");
			const reader = response.body.getReader();
			const font = new Uint8Array(asset.sizeBytes);
			let length = 0;
			try {
				for (;;) {
					const result = await reader.read();
					if (result.done) break;
					if (length + result.value.length > font.length)
						throw new Error("Font size mismatch.");
					font.set(result.value, length);
					length += result.value.length;
				}
			} finally {
				await reader.cancel().catch(() => {});
				reader.releaseLock();
			}
			if (length !== font.length) throw new Error("Incomplete font.");
			bytes.push(font);
			total += length;
		} catch {
			signal.throwIfAborted();
			degraded = true;
		}
	}
	return { bytes, degraded: !!degraded };
}
