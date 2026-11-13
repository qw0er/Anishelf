export const defaultLanguage = "en";

/** Default address shared by the server and the Web development proxy. */
export const serverDefaults = Object.freeze({
	host: "127.0.0.1",
	port: 3000,
});
const developmentPort = 5173;
export const developmentDefaults = Object.freeze({
	host: serverDefaults.host,
	port: developmentPort,
	origins: Object.freeze([
		`http://${serverDefaults.host}:${developmentPort}`,
		`http://localhost:${developmentPort}`,
	]),
});

/** Browser-safe business constraints shared by the server and Web build. */
export const subtitleConstraints = Object.freeze({
	maximumBytes: 10 * 1024 * 1024,
});

/** Bounds each browser negotiation independently of the preparation list window. */
export const playbackSelectionConstraints = Object.freeze({
	maximumCandidates: 128,
	maximumFailedResources: 256,
});

export const preparationConstraints = Object.freeze({
	moreBatchSize: 10,
});

export const subtitleFontConstraints: Readonly<{
	maximumBytes: number;
	maximumSetBytes: number;
	maximumCount: number;
}> = Object.freeze({
	maximumBytes: 24 * 1024 * 1024,
	maximumSetBytes: 64 * 1024 * 1024,
	maximumCount: 32,
});
