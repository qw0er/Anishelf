export const defaultLanguage = "en";

/** Program-maintained startup and development defaults. */
export const deploymentDefaults = Object.freeze({
	host: "127.0.0.1",
	port: 3000,
	logLevel: "info",
	logDestination: "stdout",
	ffmpeg: "ffmpeg",
	ffprobe: "ffprobe",
	windowsExecutableExtension: ".EXE",
});
const developmentPort = 5173;
export const developmentDefaults = Object.freeze({
	host: deploymentDefaults.host,
	port: developmentPort,
	origins: Object.freeze([
		`http://${deploymentDefaults.host}:${developmentPort}`,
		`http://localhost:${developmentPort}`,
	]),
});

export const logLevels = Object.freeze([
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"silent",
] as const);
