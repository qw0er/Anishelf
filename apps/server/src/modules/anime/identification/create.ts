import { AnitomyIdentificationParser } from "@anishelf/anime-identification";
import { IdentificationApplication } from "./application/identification.js";
import type { IdentificationMetadata } from "./public.js";

export function createIdentificationApplication(
	metadata?: IdentificationMetadata,
): IdentificationApplication {
	return new IdentificationApplication({
		parser: new AnitomyIdentificationParser(),
		...(metadata ? { metadata } : {}),
	});
}
