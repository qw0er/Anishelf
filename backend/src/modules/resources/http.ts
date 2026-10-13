import type { HttpInstance } from "../../transport/instance.js";
import type { LibraryApplication } from "./library/application/library.js";
import { registerLibraryRoutes } from "./library/http/library.js";
import { registerMediaRoutes } from "./library/http/media.js";
export function registerResourcesHttp(
	app: HttpInstance,
	library: LibraryApplication,
): void {
	registerLibraryRoutes(app, library);
	registerMediaRoutes(app, library);
}
