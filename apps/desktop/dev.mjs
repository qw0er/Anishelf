import { spawn } from "node:child_process";
import electron from "electron";
import ts from "typescript";
import { createServer } from "vite";

const server = await createServer();
await server.listen();
console.info("desktop.dev.renderer_ready", { url: "http://127.0.0.1:5174" });

let child;
let restarting = false;
let stopping = false;
let restartRequested = false;

function launch() {
	console.info("desktop.dev.electron_starting");
	child = spawn(electron, ["."], {
		stdio: "inherit",
		env: { ...process.env, ANISHELF_DESKTOP_DEV: "1" },
	});
	child.on("error", (error) => {
		console.error("desktop.dev.electron_failed", error);
		void stop(1);
	});
	child.on("exit", (code, signal) => {
		child = undefined;
		if (stopping) return;
		if (restarting) {
			restarting = false;
			if (restartRequested) {
				restartRequested = false;
				launch();
			}
			return;
		}
		console.info("desktop.dev.electron_exited", { code, signal });
		void stop(code ?? (signal ? 1 : 0));
	});
}

function restart() {
	if (stopping) return;
	if (!child) {
		launch();
		return;
	}
	restartRequested = true;
	if (!restarting) {
		restarting = true;
		console.info("desktop.dev.electron_restarting");
		child.kill();
	}
}

const host = ts.createWatchCompilerHost(
	"tsconfig.json",
	{ noEmitOnError: true },
	ts.sys,
	ts.createEmitAndSemanticDiagnosticsBuilderProgram,
	(diagnostic) =>
		console.error(
			ts.formatDiagnosticsWithColorAndContext([diagnostic], {
				getCanonicalFileName: (name) => name,
				getCurrentDirectory: ts.sys.getCurrentDirectory,
				getNewLine: () => ts.sys.newLine,
			}),
		),
);
const afterProgramCreate = host.afterProgramCreate;
host.afterProgramCreate = (builder) => {
	afterProgramCreate?.(builder);
	if (ts.getPreEmitDiagnostics(builder.getProgram()).length === 0) restart();
	else console.warn("desktop.dev.compile_failed");
};
const watcher = ts.createWatchProgram(host);

async function stop(code) {
	if (stopping) return;
	stopping = true;
	watcher.close();
	if (child) {
		const active = child;
		active.kill();
		await new Promise((resolve) => active.once("exit", resolve));
	}
	await server.close();
	process.exit(code);
}

process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
