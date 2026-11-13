import type { Logger } from "pino";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { AuthenticationService } from "../application.js";
import { createDeviceSessions } from "../device-sessions.js";
import type { AuthenticationStore } from "../ports.js";
import { registerAuthorization } from "./authorize.js";
import { registerDeviceRoutes } from "./device-routes.js";
import { createLoginLimits } from "./login.js";
import { createMediaLinks, type MediaLinkSources } from "./media-links.js";
import {
	registerWebSessionRoutes,
	registerWebSessionStore,
} from "./web-sessions.js";

export type { MediaLinkSources } from "./media-links.js";

export async function registerAuthentication(
	app: HttpInstance,
	options: {
		service: AuthenticationService;
		logger: Logger;
		sessionPath: string;
		secret: string;
		store: AuthenticationStore;
		sources: MediaLinkSources;
	},
) {
	const { service, store, sources, logger } = options;
	await registerWebSessionStore(app, options);
	const loginLimits = await createLoginLimits(app);
	const devices = createDeviceSessions(service, store, logger);
	const mediaLinks = createMediaLinks(service, store, sources);
	const getDevice = registerAuthorization(app, service, devices, mediaLinks);
	registerDeviceRoutes(app, service, devices, getDevice, loginLimits);
	registerWebSessionRoutes(app, service, store, loginLimits);
	mediaLinks.registerRoute(app);
}
