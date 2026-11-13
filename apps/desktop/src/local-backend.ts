import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export function startLocalBackend({
	executable,
	entry,
	target,
	dataDir,
	onExit,
}: {
	executable: string;
	entry?: string;
	target: URL;
	dataDir: string;
	onExit: () => void;
}) {
	if (target.protocol !== "http:" || target.hostname !== "127.0.0.1")
		throw new Error("A managed backend requires an HTTP address on 127.0.0.1.");
	const env = { ...process.env };
	delete env.ANISHELF_FRONTEND_DIR;

	const child: ChildProcess = spawn(executable, entry ? [entry] : [], {
		env: {
			...env,
			NODE_ENV: "production",
			ANISHELF_HOST: target.hostname,
			ANISHELF_PORT: target.port || "80",
			ANISHELF_DATA_DIR: dataDir,
		},
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	child.stdout?.pipe(process.stdout, { end: false });
	child.stderr?.pipe(process.stderr, { end: false });
	let failure: Error | undefined;
	let stopping = false;
	child.on("error", (error) => {
		failure = error;
		console.error("desktop.backend_process_failed", { error });
	});
	child.once("exit", (code, signal) => {
		console.info("desktop.backend_exited", { code, signal });
		failure = new Error(
			"The managed backend exited. See the backend output for details.",
		);
		if (!stopping) onExit();
	});
	console.info("desktop.backend_starting", { origin: target.origin });

	return {
		async ready() {
			const deadline = Date.now() + 30_000;
			while (Date.now() < deadline) {
				if (failure) throw failure;
				const response = await fetch(new URL("/api/health", target), {
					redirect: "error",
					signal: AbortSignal.timeout(1000),
				}).catch(() => undefined);
				const health = await response?.json().catch(() => undefined);
				if (
					response?.ok &&
					health &&
					typeof health === "object" &&
					"status" in health &&
					health.status === "ok"
				) {
					if (failure) throw failure;
					console.info("desktop.backend_ready", { origin: target.origin });
					return;
				}
				await delay(200);
			}
			throw new Error(
				"The managed backend did not become ready within 30 seconds.",
			);
		},
		async stop() {
			stopping = true;
			if (!child.pid || child.exitCode !== null || child.signalCode !== null)
				return;
			await new Promise<void>((resolve) => {
				const deadline = setTimeout(() => {
					child.kill("SIGKILL");
					resolve();
				}, 6000);
				child.once("exit", () => {
					clearTimeout(deadline);
					resolve();
				});
				child.kill("SIGTERM");
			});
		},
	};
}
