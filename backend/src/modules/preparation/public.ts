export { PreparationApplication } from "./application/preparation.js";
export type {
	PreparationFailureReason,
	PreparationTask,
	PreparationTaskDto,
	PreparedArtifact,
	PreparedHlsArtifact,
	PreparedResource,
} from "./domain/model.js";
export type { PreparationPolicy } from "./domain/policy.js";
export {
	preparationPolicy,
	validatePreparationPolicy,
} from "./domain/policy.js";

import type { PreparationApplication } from "./application/preparation.js";
export type PreparationApi = Pick<
	PreparationApplication,
	| "create"
	| "get"
	| "list"
	| "cancel"
	| "retry"
	| "deleteArtifact"
	| "openArtifact"
>;
