export { describeAudio, describeVideo } from "../../inspection/public.js";

export { expectedOutputSpec } from "./domain/output-spec.js";
export type * from "./identity.js";
export type * from "./result.js";
export interface PreparationRequest {
	sourceVersion: string;
	profileId: string;
	audioStreamIndices?: number[];
}
