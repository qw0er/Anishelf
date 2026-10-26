import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubtitleApplication as createApplication } from "../../src/modules/media/subtitles/create.js";
import type {
	SubtitleAsset,
	SubtitleFontSet,
} from "../../src/modules/media/subtitles/domain/model.js";
import { MediaToolError } from "../../src/platform/media/index.js";

/** Explicit test dependencies for discovery/HTTP tests that do not execute FFmpeg. */
export function createSubtitleApplication(
	options: Pick<Parameters<typeof createApplication>[0], "sources"> &
		Partial<Parameters<typeof createApplication>[0]>,
) {
	const assets = new Map<string, SubtitleAsset>();
	const fonts = new Map<string, SubtitleFontSet>();
	const unavailable = async (): Promise<never> => {
		throw new MediaToolError("TOOL_UNAVAILABLE", "Fixture tools unavailable.");
	};
	return createApplication({
		tools: { extractSubtitle: unavailable },
		inspection: { inspect: unavailable },
		repository: {
			save: (asset) => {
				assets.set(asset.id, structuredClone(asset));
			},
			saveFonts: (set) => {
				fonts.set(set.id, structuredClone(set));
			},
			list: () => structuredClone([...assets.values()]),
			listFonts: () => structuredClone([...fonts.values()]),
			get: (id) => structuredClone(assets.get(id)),
			getFonts: (id) => structuredClone(fonts.get(id)),
		},
		dataDir: join(tmpdir(), `anishelf-subtitle-fixture-${randomUUID()}`),
		...options,
	});
}
