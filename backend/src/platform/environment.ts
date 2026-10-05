import { deploymentDefaults } from "../contracts/defaults.js";

export type Environment = Readonly<Record<string, string | undefined>>;
export interface ExecutableSearch {
	readonly path: string;
	readonly pathExt: string;
}
export interface RuntimeEnvironment {
	readonly development: boolean;
	readonly executableSearch: ExecutableSearch;
}

/** Capture process environment once; adapters receive this immutable search context. */
export function captureRuntimeEnvironment(
	env: Environment = process.env,
): RuntimeEnvironment {
	return Object.freeze({
		development: env.NODE_ENV === "development",
		executableSearch: Object.freeze({
			path: env.PATH ?? "",
			pathExt: env.PATHEXT ?? deploymentDefaults.windowsExecutableExtension,
		}),
	});
}
