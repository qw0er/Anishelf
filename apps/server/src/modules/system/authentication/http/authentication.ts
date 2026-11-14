import type { Logger } from "pino";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { AuthenticationService } from "../application.js";
import { createDeviceSessions } from "../device-sessions.js";
import { createLocalDeviceSession } from "../local-device-session.js";
import type { AuthenticationStore } from "../ports.js";
import { registerAuthorization } from "./authorize.js";
import {
	registerCurrentDeviceRoute,
	registerDeviceRoutes,
} from "./device-routes.js";
import { createLoginLimits } from "./login.js";
import { createMediaLinks, type MediaLinkSources } from "./media-links.js";
import { registerPasswordRoute } from "./password.js";
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
		localDeviceToken?: string | undefined;
	},
) {
	const { service, store, sources, logger } = options;
	const mediaLinks = createMediaLinks(service, store, sources, logger);
	if (options.localDeviceToken !== undefined) {
		const device = createLocalDeviceSession(options.localDeviceToken, logger);
		const getDevice = registerAuthorization(app, service, device, mediaLinks, {
			localOnly: true,
		});
		registerCurrentDeviceRoute(app, getDevice);
		mediaLinks.registerRoute(app);
		return;
	}
	await registerWebSessionStore(app, options);
	const loginLimits = await createLoginLimits(app);
	const devices = createDeviceSessions(service, store, logger);
	const getDevice = registerAuthorization(app, service, devices, mediaLinks);
	registerDeviceRoutes(app, service, devices, getDevice, loginLimits);
	registerWebSessionRoutes(app, service, loginLimits);
	registerPasswordRoute(app, service, store, getDevice, loginLimits);
	mediaLinks.registerRoute(app);
}
