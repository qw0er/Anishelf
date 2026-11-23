import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { win32 } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function readPathOutput(
	executable: string,
	args: string[],
	environment: NodeJS.ProcessEnv,
): Promise<string> {
	const result = execFileAsync(executable, args, {
		env: environment,
		timeout: 3_000,
		maxBuffer: 1024 * 1024,
		windowsHide: true,
	});
	result.child.stdin?.end();
	return (await result).stdout;
}

export async function readConfiguredPlayerPath(
	platform: NodeJS.Platform,
	environment: NodeJS.ProcessEnv,
): Promise<string> {
	if (platform === "win32") {
		const systemRoot = environment.SystemRoot ?? environment.WINDIR;
		if (!systemRoot || !win32.isAbsolute(systemRoot)) {
			throw new Error("Windows system directory is unavailable.");
		}
		const powershell = win32.join(
			systemRoot,
			"System32",
			"WindowsPowerShell",
			"v1.0",
			"powershell.exe",
		);
		const script = [
			"[Console]::OutputEncoding = [Text.Encoding]::UTF8",
			"[Console]::Write(@([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) -join ';')",
		].join("; ");
		return readPathOutput(
			powershell,
			["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
			environment,
		);
	}

	const shell = environment.SHELL || userInfo().shell || "/bin/sh";
	// Profile scripts can print banners. Keep their output outside the PATH value.
	const output = await readPathOutput(
		shell,
		["-lic", 'exec /usr/bin/printf "\\036%s\\037" "$PATH"'],
		environment,
	);
	const end = output.lastIndexOf("\x1f");
	const start = output.lastIndexOf("\x1e", end - 1);
	if (end < 0 || start < 0) throw new Error("Shell PATH is unavailable.");
	return output.slice(start + 1, end);
}
