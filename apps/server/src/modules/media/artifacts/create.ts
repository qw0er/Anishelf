import type { Logger } from "pino";
import { PreparationArtifacts } from "./application.js";
import { PreparedMediaFiles } from "./files.js";
import type {
	PreparationArtifacts as ArtifactApi,
	ArtifactContext,
	PreparedMediaFiles as FileApi,
} from "./public.js";
export function createArtifactFiles(dataDir: string, logger: Logger): FileApi {
	return new PreparedMediaFiles(dataDir, logger);
}
export function createArtifacts(context: ArtifactContext): ArtifactApi {
	return new PreparationArtifacts(context);
}
