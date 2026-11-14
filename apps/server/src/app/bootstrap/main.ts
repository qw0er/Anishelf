import { startBackend } from "./start-backend.js";

const shutdownTimeoutMs = 5000;

async function main(): Promise<void> {
	const backend = await startBackend({ env: process.env });
	const shutdown = () => {
		process.off("SIGINT", shutdown);
		process.off("SIGTERM", shutdown);
		const timer = setTimeout(() => {
			process.stderr.write(
				`Anishelf shutdown exceeded ${shutdownTimeoutMs} milliseconds.\n`,
			);
			process.exit(1);
		}, shutdownTimeoutMs);
		timer.unref();
		void backend
			.close()
			.catch((error: unknown) => {
				console.error("Anishelf shutdown failed.", error);
				process.exitCode = 1;
			})
			.finally(() => clearTimeout(timer));
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

await main().catch((error: unknown) => {
	if (error instanceof AggregateError) console.error(error);
	process.exitCode = 1;
});
