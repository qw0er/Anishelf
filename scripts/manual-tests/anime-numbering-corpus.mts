import {
	evaluateNumberingCorpus,
	loadNumberingCorpus,
} from "../../backend/test/support/anime-numbering-corpus.js";

const [command = "test", ...arguments_] = process.argv.slice(2);
if (arguments_.length || !["test", "summary"].includes(command)) {
	console.error(
		JSON.stringify({
			event: "anime_numbering.command_rejected",
			usage:
				"node --import tsx scripts/manual-tests/anime-numbering-corpus.mts <test|summary>",
		}),
	);
	process.exitCode = 2;
} else {
	try {
		console.error(
			JSON.stringify({
				event: "anime_numbering.started",
				command,
				offline: true,
			}),
		);
		const corpus = await loadNumberingCorpus();
		if (command === "summary") {
			console.log(
				JSON.stringify(
					{
						event: "anime_numbering.summary",
						version: corpus.version,
						extractedFrom: corpus.extractedFrom,
						evidenceOrigin: corpus.evidenceOrigin,
						total: corpus.cases.length,
						labelled: corpus.cases.filter((entry) => entry.expected !== null)
							.length,
						selectedWork: corpus.cases.filter((entry) => entry.workId !== null)
							.length,
						works: corpus.works.length,
					},
					null,
					2,
				),
			);
		} else {
			const report = evaluateNumberingCorpus(corpus);
			console.log(JSON.stringify(report, null, 2));
			console.error(
				JSON.stringify({
					event: "anime_numbering.completed",
					...report.summary,
				}),
			);
			if (report.summary.failed) process.exitCode = 1;
		}
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "anime_numbering.failed",
				command,
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		process.exitCode = 1;
	}
}
