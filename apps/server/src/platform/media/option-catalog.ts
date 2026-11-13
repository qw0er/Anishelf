import type { DeepReadonly } from "../../shared/policy.js";
import type { ServerMediaCapabilities } from "./capability-model.js";
import type {
	AudioEncoding,
	EncodingOptions,
	EncodingValidation,
	VideoEncoding,
} from "./encoding.js";
import { filterName, type OptionScope } from "./encoding-policy.js";

interface OptionDescription {
	flags: string;
	scopes: OptionScope[];
}
export interface OptionHelp {
	options: Map<string, OptionDescription>;
	pixelFormats?: string[] | undefined;
	available: boolean;
}
/** Keep only common options from full help; encoder/muxer options come from selected component help. */
export function parseOptionHelp(source: string, component = false): OptionHelp {
	const options = new Map<string, OptionDescription>();
	let scopes: OptionScope[] = [];
	let common = component;
	for (const line of source.split(/\r?\n/)) {
		if (/^.*AVOptions:$/.test(line)) {
			common =
				component || /^(AVCodecContext|AVFormatContext) AVOptions:$/.test(line);
			scopes = /^AVCodecContext/.test(line)
				? ["video", "audio", "input"]
				: ["input", "muxer"];
		} else if (/^\S.*:$/.test(line)) {
			common = component || !/AVOptions/.test(line);
			scopes = /global options/i.test(line)
				? ["global"]
				: /input.*output/i.test(line)
					? ["input", "muxer", "video", "audio"]
					: /input/i.test(line)
						? ["input"]
						: /video/i.test(line)
							? ["video"]
							: /audio/i.test(line)
								? ["audio"]
								: /output/i.test(line)
									? ["muxer", "video", "audio"]
									: [];
		}
		const match = line.match(/^\s*-(\w[\w-]*)(?:\[:[^\]]+\])?\s+(.*)$/);
		if (!match || !common) continue;
		const flags = match[2]?.match(/\b([EDVASFXRBT.P]{6,})\b/)?.[1] ?? "";
		options.set(match[1] as string, { flags, scopes: component ? [] : scopes });
	}
	return {
		options,
		available: options.size > 0 || /^(Encoder|Muxer) /m.test(source),
		pixelFormats: source
			.match(/Supported pixel formats:\s*([^\r\n]+)/)?.[1]
			?.trim()
			.split(/\s+/),
	};
}
export interface EncodingProfileShape {
	id: string;
	container: string;
	video: VideoEncoding;
	audio: AudioEncoding;
	globalOptions?: EncodingOptions | undefined;
	inputOptions?: EncodingOptions | undefined;
	muxerOptions?: EncodingOptions | undefined;
}

/** Help is evidence of advertised syntax, never hardware or combination certification. */
export async function inspectEncodingProfiles<T extends EncodingProfileShape>(
	profiles: DeepReadonly<T[]>,
	server: ServerMediaCapabilities,
	help: (topic: string) => Promise<OptionHelp>,
): Promise<{ profiles: T[]; validation: Record<string, EncodingValidation> }> {
	const normalized = structuredClone(profiles) as unknown as T[];
	const validation: Record<string, EncodingValidation> = {};
	const common = await help("full");
	for (const profile of normalized) {
		const issues: EncodingValidation["issues"] = [];
		let status: EncodingValidation["status"] =
			common.available && server.status === "ready"
				? "recognized"
				: "unverified";
		const issue = (field: string, message: string, unsupported = false) => {
			issues.push({ field, message });
			if (unsupported) status = "unsupported";
			else if (status !== "unsupported") status = "unverified";
		};
		const checkOptions = (
			options: EncodingOptions | undefined,
			scope: OptionScope,
			local?: OptionHelp,
		) => {
			for (const [name, value] of Object.entries(options ?? {})) {
				const field =
					scope === "global" || scope === "input" || scope === "muxer"
						? `${scope}Options.${name}`
						: `${scope}.options.${name}`;
				const description =
					local?.options.get(name) ?? common.options.get(name);
				if (!description) {
					issue(
						field,
						"This option was not identified by FFmpeg help; execution will validate it.",
					);
					continue;
				}
				const flags = description.flags;
				if (
					(description.scopes.length && !description.scopes.includes(scope)) ||
					(scope === "video" && flags.includes("A") && !flags.includes("V")) ||
					(scope === "audio" && flags.includes("V") && !flags.includes("A")) ||
					((scope === "video" || scope === "audio") &&
						flags.includes("D") &&
						!flags.includes("E")) ||
					(scope === "input" && flags.includes("E") && !flags.includes("D")) ||
					(scope === "muxer" && flags.includes("D") && !flags.includes("E"))
				)
					issue(field, "The detected option belongs to another scope.", true);
				if (name.endsWith("-params") || name.endsWith("opts") || value === null)
					issue(field, "The option value requires execution validation.");
			}
		};
		checkOptions(profile.globalOptions, "global");
		checkOptions(profile.inputOptions, "input");
		const muxer = await help(`muxer=${profile.container}`);
		if (
			server.inventory.muxers.status === "ready" &&
			!server.inventory.muxers.entries.some((e) => e.name === profile.container)
		)
			issue("container", "The muxer is not installed.", true);
		checkOptions(profile.muxerOptions, "muxer", muxer);
		for (const [kind, stream] of [
			["video", profile.video],
			["audio", profile.audio],
		] as const) {
			if (stream.encoder === "copy") continue;
			const entry = server.inventory.encoders.entries.find(
				(e) => e.name === stream.encoder && e.mediaType === kind,
			);
			if (!entry && server.inventory.encoders.status === "ready")
				issue(`${kind}.encoder`, "The encoder is not installed.", true);
			if (!stream.codec) {
				if (entry?.codec) stream.codec = entry.codec;
				else
					issue(
						`${kind}.codec`,
						"Provide codec explicitly; it could not be inferred from this FFmpeg build.",
						server.inventory.encoders.status === "ready",
					);
			} else if (entry?.codec && entry.codec !== stream.codec)
				issue(
					`${kind}.codec`,
					"The codec does not match the detected encoder.",
					true,
				);
			const local = await help(`encoder=${stream.encoder}`);
			if (!local.available)
				issue(`${kind}.encoder`, "Encoder option information is unavailable.");
			checkOptions(stream.options, kind, local);
			if (
				kind === "video" &&
				profile.video.pixelFormat &&
				local.pixelFormats?.length &&
				!local.pixelFormats.includes(profile.video.pixelFormat)
			)
				issue(
					"video.pixelFormat",
					"The encoder does not advertise this pixel format.",
					true,
				);
			for (const expression of stream.filters ?? []) {
				const name = filterName(expression);
				const filter = server.inventory.filters.entries.find(
					(e) => e.name === name,
				);
				if (!filter)
					issue(
						`${kind}.filters`,
						"A filter is missing or could not be identified.",
						server.inventory.filters.status === "ready",
					);
				else if (
					!filter.description.startsWith(kind === "video" ? "V->V" : "A->A")
				)
					issue(
						`${kind}.filters`,
						"Only single-input single-output filters of this stream type are supported.",
						true,
					);
			}
		}
		validation[profile.id] = { status, issues };
	}
	return { profiles: normalized, validation };
}
