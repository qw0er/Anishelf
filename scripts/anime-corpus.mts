import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	evaluateCorpus,
	loadCorpus,
	materializeCorpus,
	summarizeCorpus,
} from "../backend/test/support/anime-corpus.js";

const [command = "summary", argument] = process.argv.slice(2);
const corpus = await loadCorpus();
switch (command) {
	case "summary":
		console.log(JSON.stringify(summarizeCorpus(corpus), null, 2));
		break;
	case "generate":
		if (!argument)
			throw new Error("Usage: anime:corpus generate <new-directory>");
		console.log(
			JSON.stringify(
				await materializeCorpus(corpus, resolve(argument)),
				null,
				2,
			),
		);
		break;
	case "evaluate": {
		if (!argument)
			throw new Error("Usage: anime:corpus evaluate <predictions.json>");
		const report = evaluateCorpus(
			corpus,
			JSON.parse(await readFile(resolve(argument), "utf8")),
		);
		console.log(JSON.stringify(report, null, 2));
		if (report.passed !== report.total) process.exitCode = 1;
		break;
	}
	default:
		throw new Error(`Unknown anime corpus command: ${command}`);
}
