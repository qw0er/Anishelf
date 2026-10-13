import type { Logger } from "pino";
import type { LibraryApi, ResourceAccessApi } from "../../resources/public.js";
import { IdentificationApplication } from "../identification/application/identification.js";
import { AnitomyIdentificationParser } from "../identification/infrastructure/parser.js";
import type {
	IdentificationMetadata,
	IdentificationResult,
} from "../identification/public.js";
import { AutomaticIdentificationCoordinator } from "../workflows/automatic-identification.js";

/** Recognition needs neither database availability nor an HTTP entry point. */
export function createIdentificationModule(options: {
	library: LibraryApi;
	sources: ResourceAccessApi;
	logger: Logger;
	metadata?: IdentificationMetadata;
	onPublication?: (
		results: readonly IdentificationResult[],
		canonicalRoot: string,
	) => void;
}): AutomaticIdentificationCoordinator {
	const identification = new IdentificationApplication({
		parser: new AnitomyIdentificationParser(),
		...(options.metadata ? { metadata: options.metadata } : {}),
	});
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
