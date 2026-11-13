import { resolve } from "node:path";
import {
	loadCorpus,
	materializeCorpus,
	parseCorpusCommand,
	summarizeCorpus,
} from "../../apps/server/test/support/anime-corpus.js";
import {
	loadReportedCorpus,
	reportedResources,
} from "../../apps/server/test/support/anime-reported-cases.js";

const parsed = parseCorpusCommand(process.argv.slice(2));
if (!parsed) {
	console.error(
		JSON.stringify({
			event: "anime_corpus.command_rejected",
			usage:
				"node --import tsx scripts/manual-tests/anime-corpus.mts <summary|generate <new-directory>>; run node --import tsx scripts/manual-tests/anime-identification-corpus.mts for the complete identification audit.",
		}),
	);
	process.exitCode = 2;
} else {
	const { command } = parsed;
	try {
		console.error(
			JSON.stringify({ event: "anime_corpus.started", command, offline: true }),
		);
		const [corpus, reported] = await Promise.all([
			loadCorpus(),
			loadReportedCorpus(),
		]);
		const result =
			command === "summary"
				? {
						event: "anime_corpus.summary",
						...summarizeCorpus(corpus),
						reported: {
							version: reported.version,
							scenarios: reported.scenarios.length,
							files: reportedResources(reported).length,
						},
					}
				: {
						event: "anime_corpus.generated",
						...(await materializeCorpus(corpus, resolve(parsed.destination), {
							version: reported.version,
							resources: reportedResources(reported),
						})),
					};
		console.log(JSON.stringify(result, null, 2));
		console.error(JSON.stringify({ event: "anime_corpus.completed", command }));
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "anime_corpus.failed",
				command,
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		process.exitCode = 1;
	}
}
