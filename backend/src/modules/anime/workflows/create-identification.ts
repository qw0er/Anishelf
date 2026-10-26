import type { Logger } from "pino";
import type { LibraryApi, ResourceAccessApi } from "../../resources/public.js";
import { createIdentificationApplication } from "../identification/create.js";
import type {
	IdentificationMetadata,
	IdentificationResult,
} from "../identification/public.js";
import { AutomaticIdentificationCoordinator } from "./automatic-identification.js";

/** Recognition needs neither database availability nor an HTTP entry point. */
export function createIdentificationModule(options: {
	library: LibraryApi;
	sources: ResourceAccessApi;
	logger: Logger;
	metadata?: IdentificationMetadata;
	onPublication?: (
		results: readonly IdentificationResult[],
		scopeIds: readonly string[],
		signal: AbortSignal,
		fileIds?: readonly string[],
	) => void | Promise<void>;
}): AutomaticIdentificationCoordinator {
	const identification = createIdentificationApplication(options.metadata);
	const coordinator = new AutomaticIdentificationCoordinator({
		library: options.library,
		sources: options.sources,
		identification,
		logger: options.logger,
		...(options.onPublication ? { onPublication: options.onPublication } : {}),
	});
	coordinator.start();
	return coordinator;
}
