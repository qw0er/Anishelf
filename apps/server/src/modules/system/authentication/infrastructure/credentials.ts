import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeStateFile } from "../../../../platform/state-file.js";

function derive(
	password: string,
	salt: string,
	length: number,
	options: typeof parameters,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(password, salt, length, options, (error, key) => {
			if (error) reject(error);
			else resolve(key);
		});
	});
}
const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export interface Credential {
	version: 1;
	algorithm: "scrypt";
	salt: string;
	hash: string;
	N: number;
	r: number;
	p: number;
}
export function randomPassword() {
	return randomBytes(24).toString("base64url");
}
export function normalizePassword(password: string) {
	return password.trim();
}
export async function hashPassword(password: string): Promise<Credential> {
	const normalized = normalizePassword(password);
	if ([...normalized].length < 8 || [...normalized].length > 128)
		throw new Error("Password must contain 8–128 characters.");
	const salt = randomBytes(16).toString("hex");
	const hash = (
		(await derive(normalized, salt, 32, parameters)) as Buffer
	).toString("hex");
	return {
		version: 1,
		algorithm: "scrypt",
		salt,
		hash,
		N: parameters.N,
		r: parameters.r,
		p: parameters.p,
	};
}
function parseCredential(text: string): Credential {
	let value: Credential;
	try {
		value = JSON.parse(text) as Credential;
	} catch {
		throw new Error(
			"Invalid auth.json. Restore a backup or run auth reset-password.",
		);
	}
	if (
		value?.version !== 1 ||
		value.algorithm !== "scrypt" ||
		value.N !== parameters.N ||
		value.r !== parameters.r ||
		value.p !== parameters.p ||
		!/^[a-f0-9]{32}$/.test(value.salt) ||
		!/^[a-f0-9]{64}$/.test(value.hash)
	)
		throw new Error(
			"Invalid auth.json. Restore a backup or run auth reset-password.",
		);
	return value;
}
export function credentialFingerprint(value: Credential) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export async function verifyPassword(password: string, credential: Credential) {
	const hash = (await derive(
		normalizePassword(password),
		credential.salt,
		32,
		parameters,
	)) as Buffer;
	return timingSafeEqual(hash, Buffer.from(credential.hash, "hex"));
}
export async function replaceCredential(
	dataDir: string,
	credential: Credential,
) {
	await mkdir(dataDir, { recursive: true, mode: 0o700 });
	await chmod(dataDir, 0o700);
	await writeStateFile(
		join(dataDir, "auth.json"),
		`${JSON.stringify(credential, null, 2)}\n`,
	);
}
export async function loadCredentials(dataDir: string) {
	await mkdir(dataDir, { recursive: true, mode: 0o700 });
	await chmod(dataDir, 0o700);
	const path = join(dataDir, "auth.json");
	let initialPassword: string | undefined;
	let credential: Credential;
	try {
		credential = parseCredential(await readFile(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const password = randomPassword();
		const generated = await hashPassword(password);
		if (
			await writeStateFile(path, `${JSON.stringify(generated, null, 2)}\n`, {
				createOnly: true,
			})
		)
			initialPassword = password;
		credential = parseCredential(await readFile(path, "utf8"));
	}
	await chmod(path, 0o600);
	const keyPath = join(dataDir, "auth-session.key");
	try {
		await readFile(keyPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		await writeStateFile(keyPath, randomBytes(32).toString("hex"), {
			createOnly: true,
		});
	}
	const secret = await readFile(keyPath, "utf8");
	if (!/^[a-f0-9]{64}$/.test(secret))
		throw new Error("Invalid auth-session.key.");
	await chmod(keyPath, 0o600);
	return { credential, secret, initialPassword };
}
