import { serverDefaults } from "@anishelf/contracts/defaults";

export const defaultDesktopDevUrl = "http://127.0.0.1:5174";

export function desktopApiTarget() {
	return (
		process.env.ANISHELF_API_TARGET ??
		`http://${serverDefaults.host}:${process.env.ANISHELF_PORT ?? serverDefaults.port}`
	);
}
