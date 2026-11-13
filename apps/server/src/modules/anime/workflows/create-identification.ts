import type { Logger } from "pino";
import type { LibraryApi, ResourceAccessApi } from "../../resources/public.js";
import type { AnimeCatalogApi } from "../anime-catalog/public.js";
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
	metadataContext?: () => string;
	metadata?: IdentificationMetadata;
	catalog?: Pick<AnimeCatalogApi, "reviews" | "review"> &
		Partial<Pick<AnimeCatalogApi, "reusableAcquisitions">>;
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
		...(options.metadataContext
			? { metadataContext: options.metadataContext }
			: {}),
		...(options.catalog ? { catalog: options.catalog } : {}),
		...(options.onPublication ? { onPublication: options.onPublication } : {}),
	});
	coordinator.start();
	return coordinator;
}
