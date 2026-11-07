import { resolve } from "node:path";
import {
	loadCorpus,
	materializeCorpus,
	summarizeCorpus,
} from "../backend/test/support/anime-corpus.js";
import {
	loadReportedCorpus,
	reportedResources,
} from "../backend/test/support/anime-reported-cases.js";

const [command = "summary", ...arguments_] = process.argv.slice(2);
if (
	!(
		(command === "summary" && arguments_.length === 0) ||
		(command === "generate" && arguments_.length === 1 && arguments_[0])
	)
) {
	console.error(
		JSON.stringify({
			event: "anime_corpus.command_rejected",
			usage:
				"npm run anime:corpus -- <summary|generate <new-directory>>; run anime:identification for the complete identification audit.",
		}),
	);
	process.exitCode = 2;
} else {
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
						...(await materializeCorpus(corpus, resolve(arguments_[0] ?? ""), {
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
