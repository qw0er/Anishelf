import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import {
	hashPassword,
	normalizePassword,
	randomPassword,
	replaceCredential,
} from "./infrastructure/credentials.js";
export async function authenticationCommand(command: string, dataDir: string) {
	if (command === "hash-password") {
		if (!process.stdin.isTTY)
			throw new Error("Use an interactive terminal to enter a password.");
		const muted = new Writable({
			write(_chunk, _encoding, callback) {
				callback();
			},
		});
		const reader = createInterface({
			input: process.stdin,
			output: muted,
			terminal: true,
		});
		try {
			process.stderr.write("Password (8–128 characters): ");
			const password = normalizePassword(await reader.question(""));
			process.stderr.write("\nConfirm password: ");
			const confirmation = normalizePassword(await reader.question(""));
			process.stderr.write("\n");
			if (password !== confirmation) throw new Error("Passwords do not match.");
			process.stdout.write(
				`${JSON.stringify(await hashPassword(password), null, 2)}\n`,
			);
		} finally {
			reader.close();
			muted.end();
		}
	} else if (command === "reset-password") {
		const password = randomPassword();
		await replaceCredential(dataDir, await hashPassword(password));
		process.stdout.write(
			`Password reset in ${dataDir}/auth.json.\nNew password: ${password}\nRestart Anishelf to invalidate existing sessions and media links.\n`,
		);
	} else
		throw new Error(
			"Usage: node backend/dist/cli.js auth <hash-password|reset-password>",
		);
}
