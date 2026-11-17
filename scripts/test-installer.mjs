import { spawnSync } from "node:child_process";

if (process.platform === "win32") {
	console.log("Skipping installer tests on Windows.");
} else {
	const result = spawnSync(
		"python3",
		["-m", "unittest", "discover", "-s", "scripts/installer_tests", "-v"],
		{ stdio: "inherit" },
	);
	if (result.error) {
		console.error("Failed to run installer tests:", result.error);
	}
	process.exitCode = result.status ?? 1;
}
