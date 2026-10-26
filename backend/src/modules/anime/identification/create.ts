import { IdentificationApplication } from "./application/identification.js";
import { AnitomyIdentificationParser } from "./infrastructure/parser.js";
import type { IdentificationMetadata } from "./public.js";

export function createIdentificationApplication(
	metadata?: IdentificationMetadata,
): IdentificationApplication {
	return new IdentificationApplication({
		parser: new AnitomyIdentificationParser(),
		...(metadata ? { metadata } : {}),
	});
}
