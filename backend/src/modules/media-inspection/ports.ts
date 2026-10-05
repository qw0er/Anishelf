import type { MediaInfo } from "../../platform/media/model.js";
import type { ResolvedSource } from "../resource-access/public.js";
export class MediaInspectionBusyError extends Error {
	constructor() {
		super("Media inspection is busy.");
		this.name = "MediaInspectionBusyError";
	}
}

export interface MediaInspectionResult {
	source: ResolvedSource;
	info: MediaInfo;
}

export interface MediaProbe {
	probe(path: string, signal?: AbortSignal): Promise<MediaInfo>;
}
export interface MediaInspectionApi {
	inspect(
		fileId: string,
		expectedSourceVersion?: string,
	): Promise<MediaInspectionResult>;
}
