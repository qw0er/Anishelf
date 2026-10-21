import type { MediaInfo } from "../../../platform/media/model.js";
import type { ResolvedSource } from "../../resources/public.js";
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

export interface InspectionRecord {
	scopeId: string;
	fileId: string;
	sourceVersion: string;
	formatVersion: string;
	info: MediaInfo;
}
export interface InspectionStore {
	find(scopeId: string, fileId: string): InspectionRecord | null;
	save(value: InspectionRecord): void;
	reconcile(
		scopes: readonly string[],
		files: ReadonlyMap<string, string>,
		configuredScopes: readonly string[],
	): number;
}
