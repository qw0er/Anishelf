import {
	evaluateParsingCorpus,
	loadParsingCorpus,
	summarizeParsingCorpus,
} from "../backend/test/support/anime-parsing-corpus.js";

const [command = "test", ...arguments_] = process.argv.slice(2);
if (arguments_.length || !["test", "summary"].includes(command)) {
	console.error(
		JSON.stringify({
			event: "anime_parsing.command_rejected",
			usage: "npm run anime:parsing -- <test|summary>",
		}),
	);
	process.exitCode = 2;
} else {
	try {
		console.error(
			JSON.stringify({
				event: "anime_parsing.started",
				command,
				offline: true,
			}),
		);
		const corpus = await loadParsingCorpus();
		if (command === "summary") {
			console.log(
				JSON.stringify(
					{
						event: "anime_parsing.summary",
						...summarizeParsingCorpus(corpus),
					},
					null,
					2,
				),
			);
		} else {
			const report = evaluateParsingCorpus(corpus);
			console.log(JSON.stringify(report, null, 2));
			console.error(
				JSON.stringify({ event: "anime_parsing.completed", ...report.summary }),
			);
			if (report.summary.failed) process.exitCode = 1;
		}
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "anime_parsing.failed",
				command,
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		process.exitCode = 1;
	}
}
