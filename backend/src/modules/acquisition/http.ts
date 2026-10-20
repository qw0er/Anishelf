import type { HttpInstance } from "../../transport/instance.js";
import { registerConnectionRoutes } from "./connection/http/connection.js";
import type { AcquisitionApi } from "./public.js";

export function registerAcquisitionHttp(
	app: HttpInstance,
	api: AcquisitionApi,
) {
	registerConnectionRoutes(app, api.connection);
}
