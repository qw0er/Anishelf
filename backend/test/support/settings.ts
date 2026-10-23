import type { LibraryApplication } from "../../src/modules/resources/library/application/library.js";
import type { PersistentSettings } from "../../src/modules/system/public.js";
import { fixtureSettings } from "./library.js";
export function updateResourceSettings(
	owner: LibraryApplication,
	input: Partial<PersistentSettings>,
) {
	return fixtureSettings(owner).updateSettings(input);
}
