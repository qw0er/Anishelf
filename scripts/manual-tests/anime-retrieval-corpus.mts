import {
	evaluateRetrievalCorpus,
	loadRetrievalCorpus,
} from "../../apps/server/test/support/anime-retrieval-corpus.js";

const [command = "test", ...extra] = process.argv.slice(2);
if (extra.length || !["summary", "test"].includes(command)) {
	console.error(
		JSON.stringify({
			event: "anime_retrieval.command_rejected",
			usage:
				"node --import tsx scripts/manual-tests/anime-retrieval-corpus.mts <summary|test>",
		}),
	);
	process.exitCode = 2;
} else {
	try {
		console.error(
			JSON.stringify({
				event: "anime_retrieval.started",
				command,
				offline: true,
			}),
		);
		const corpus = await loadRetrievalCorpus();
		const report =
			command === "test"
				? evaluateRetrievalCorpus(corpus)
				: {
						event: "anime_retrieval.summary",
						version: corpus.version,
						cases: corpus.cases.length,
						requests: corpus.records.length,
					};
		console.log(JSON.stringify(report, null, 2));
		if ("failed" in report && report.failed) process.exitCode = 1;
		console.error(
			JSON.stringify({
				event: "anime_retrieval.completed",
				command,
				failed: process.exitCode === 1,
			}),
		);
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "anime_retrieval.failed",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		process.exitCode = 1;
	}
}
