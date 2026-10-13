import type { Logger } from "pino";
import { IdentificationApplication } from "../../modules/anime/identification/application/identification.js";
import { AnitomyIdentificationParser } from "../../modules/anime/identification/infrastructure/parser.js";
import type {
	IdentificationMetadata,
	IdentificationResult,
} from "../../modules/anime/identification/public.js";
import type { LibraryApi } from "../../modules/resources/library/public.js";
import type { ResourceAccessApi } from "../../modules/resources/resource-access/public.js";
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
