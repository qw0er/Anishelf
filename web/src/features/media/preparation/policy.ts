import { preparationConstraints } from "@anishelf/backend/contracts/defaults";
export const preparationPolicy = preparationConstraints;
export const preparationInteractionPolicy = Object.freeze({
	preparationPollIntervalMs: 1000,
	preparationRequestTimeoutMs: 30000,
});
