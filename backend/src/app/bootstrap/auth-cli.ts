import { runAuthenticationCommand } from "../../modules/system/create.js";
export async function runAuthCli() {
	try {
		if (process.argv[2] !== "auth")
			throw new Error(
				"Usage: node backend/dist/cli.js auth <hash-password|reset-password>",
			);
		await runAuthenticationCommand(process.argv[3] ?? "", process.env);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : "Authentication command failed."}\n`,
		);
		process.exitCode = 1;
	}
}
