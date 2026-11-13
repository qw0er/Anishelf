import { serverDefaults } from "@anishelf/contracts/defaults";

export const deploymentDefaults = Object.freeze({
	...serverDefaults,
	logLevel: "info",
	logDestination: "stdout",
	logMaxSizeBytes: 10 * 1024 * 1024,
	logMaxFiles: 7,
	logRotateInterval: "1d" as const,
	ffmpeg: "ffmpeg",
	ffprobe: "ffprobe",
	windowsExecutableExtension: ".EXE",
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
