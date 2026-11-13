import type { Logger } from "pino";
import type { DeepReadonly } from "../../../shared/policy.js";
import type { ResourceAccessApi } from "../../resources/public.js";
import { SubtitleApplication } from "./application/subtitles.js";
import { type SubtitleRuntimePolicy, subtitleRuntimePolicy } from "./policy.js";
export function createSubtitleApplication(options: {
	sources: ResourceAccessApi;
	policy?: DeepReadonly<SubtitleRuntimePolicy>;
	logger?: Logger;
}) {
	return new SubtitleApplication({
		...options,
		policy: options.policy ?? subtitleRuntimePolicy,
	});
}
