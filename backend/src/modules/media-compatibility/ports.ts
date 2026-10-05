import type {
	CompatibilityCheckRequest,
	CompatibilityInspection,
} from "../../contracts/http.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type {
	CheckedCompatibility,
	CompatibilityInspectInput,
} from "./domain/model.js";
export interface MediaCompatibilityApi {
	inspect(input: CompatibilityInspectInput): Promise<CompatibilityInspection>;
	check(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<DeepReadonly<CheckedCompatibility>>;
}
