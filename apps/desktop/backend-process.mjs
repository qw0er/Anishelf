import { pathToFileURL } from "node:url";

const parent = process.parentPort;
const [, , backendPath, dataDir] = process.argv;
if (!parent || !backendPath || !dataDir)
	throw new Error("Missing desktop backend process configuration.");

let backend;
let stopping = false;

async function stop() {
	try {
		await backend.close();
		process.exit(0);
	} catch (error) {
		console.error("desktop.backend_shutdown_failed", { error });
		process.exit(1);
	}
}

parent.on("message", ({ data }) => {
	if (data !== "shutdown" || stopping) return;
	stopping = true;
	if (backend) void stop();
});

try {
	const { startDesktopBackend } = await import(pathToFileURL(backendPath).href);
	backend = await startDesktopBackend({ dataDir });
	if (stopping) await stop();
	else {
		parent.postMessage({
			type: "ready",
			origin: backend.origin,
			deviceToken: backend.deviceToken,
		});
	}
} catch (error) {
	console.error("desktop.backend_start_failed", { error });
	process.exit(1);
}
