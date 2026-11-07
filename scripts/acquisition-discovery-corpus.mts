import {
	evaluateDiscoveryCorpus,
	loadDiscoveryCorpus,
} from "../backend/test/support/acquisition-discovery-corpus.js";

const [command = "test", ...extra] = process.argv.slice(2);
if (extra.length || !["test", "summary"].includes(command)) {
	console.error(
		JSON.stringify({
			event: "acquisition_discovery.command_rejected",
			usage: "npm run acquisition:discovery -- <summary|test>",
		}),
	);
	process.exitCode = 2;
} else {
	try {
		console.error(
			JSON.stringify({
				event: "acquisition_discovery.started",
				command,
				offline: true,
			}),
		);
		const corpus = await loadDiscoveryCorpus();
		const report =
			command === "test"
				? await evaluateDiscoveryCorpus(corpus)
				: {
						event: "acquisition_discovery.summary",
						version: corpus.version,
						cases: corpus.cases.length,
						publications: corpus.entries.length,
						provenance: corpus.provenance,
					};
		console.log(JSON.stringify(report, null, 2));
		if ("failed" in report && report.failed) process.exitCode = 1;
		console.error(
			JSON.stringify({
				event: "acquisition_discovery.completed",
				failed: process.exitCode === 1,
			}),
		);
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "acquisition_discovery.failed",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		process.exitCode = 1;
	}
}
