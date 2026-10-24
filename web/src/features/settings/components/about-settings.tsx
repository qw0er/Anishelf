import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { request } from "../../../shared/api/client.js";
import type { BuildInfo, UpdateCheck } from "../../../shared/api/contracts.js";
import { ActionButton } from "../../../shared/components/ui/action-button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../shared/components/ui/card.js";
import { toast } from "../../../shared/components/ui/toast.js";

declare const __ANISHELF_BUILD__: BuildInfo;
const webBuild = __ANISHELF_BUILD__;
const repository = "https://github.com/qw0er/Anishelf";
const updateKey = ["system", "updates"];
const statusLabels: Record<UpdateCheck["status"], string> = {
	available: "A new version is available.",
	current: "You are up to date.",
	ahead: "This version is newer than the latest stable release.",
	uncomparable: "This build cannot be compared with stable releases.",
	"no-release": "No stable release has been published.",
};

function BuildDetails({ label, info }: { label: string; info: BuildInfo }) {
	return (
		<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
			<span className="w-14 shrink-0 font-medium text-foreground">{label}</span>
			<span>
				v{info.version} · {info.channel}
			</span>
			{info.commit && <code className="break-all">{info.commit}</code>}
			{info.builtAt && (
				<span>Built {new Date(info.builtAt).toLocaleString()}</span>
			)}
		</div>
	);
}

export function AboutSettings() {
	const client = useQueryClient();
	const info = useQuery({
		queryKey: ["system", "info"],
		queryFn: ({ signal }) =>
			request<BuildInfo>("/api/system/info", "GET", { signal }),
		staleTime: Number.POSITIVE_INFINITY,
	});
	const updates = useQuery<UpdateCheck>({
		queryKey: updateKey,
		enabled: false,
		queryFn: () => request<UpdateCheck>("/api/system/updates/check", "POST"),
	});
	const check = useMutation({
		mutationFn: () => request<UpdateCheck>("/api/system/updates/check", "POST"),
		onSuccess: (result) => {
			client.setQueryData(updateKey, result);
			toast.add({
				id: "update-check",
				type: "info",
				title: statusLabels[result.status],
			});
		},
		onError: () => {
			toast.add({
				id: "update-check",
				type: "error",
				title: "Could not check for updates. Try again later.",
			});
		},
	});
	const mismatch =
		info.data &&
		(info.data.version !== webBuild.version ||
			info.data.commit !== webBuild.commit ||
			info.data.channel !== webBuild.channel);
	const current = info.data ?? webBuild;
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>Anishelf</CardTitle>
				<CardDescription>
					Your anime library, tracking and playback.
				</CardDescription>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
					{[
						["Project", repository],
						["Docs", `${repository}/tree/main/docs/guide`],
						["Issues", `${repository}/issues`],
					].map(([label, href]) => (
						<a
							key={label}
							className="text-muted-foreground hover:text-foreground hover:underline"
							href={href}
							target="_blank"
							rel="noreferrer"
						>
							{label}
						</a>
					))}
					<span className="text-xs text-muted-foreground">AGPL-3.0-only</span>
				</div>
			</CardHeader>
			<CardContent className="flex min-w-0 flex-col gap-3 lg:max-w-2xl">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-wrap items-baseline gap-2">
						<span className="font-medium">v{current.version}</span>
						{current.channel !== "stable" && (
							<span className="text-xs text-muted-foreground capitalize">
								{current.channel}
							</span>
						)}
					</div>
					<ActionButton
						icon={RefreshCw}
						label="Check for updates"
						shortLabel="Check"
						variant="outline"
						aria-busy={check.isPending}
						disabled={check.isPending || !info.data}
						onClick={() => check.mutate()}
					/>
				</div>
				{info.isPending && (
					<p className="text-sm text-muted-foreground" role="status">
						Loading backend version…
					</p>
				)}
				{info.isError && (
					<p className="text-sm text-destructive" role="alert">
						Could not load the backend version.{" "}
						<button
							type="button"
							className="underline"
							onClick={() => void info.refetch()}
						>
							Retry
						</button>
					</p>
				)}
				{mismatch && (
					<p role="alert" className="text-sm text-destructive">
						Web and Backend builds differ. Deploy matching versions of both
						components.
					</p>
				)}
				{updates.data && (
					<div
						className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
						aria-live="polite"
					>
						<span>{statusLabels[updates.data.status]}</span>
						{updates.data.latest && (
							<a
								className="underline underline-offset-4"
								href={updates.data.latest.url}
								target="_blank"
								rel="noreferrer"
							>
								{updates.data.latest.version} · Release notes
							</a>
						)}
						<span className="text-xs text-muted-foreground">
							Checked {new Date(updates.data.checkedAt).toLocaleString()}
						</span>
					</div>
				)}
				{check.isError && (
					<p role="alert" className="text-sm text-destructive">
						The latest check failed. Any previous result is from the last
						successful check.
					</p>
				)}
				<div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t pt-3 text-sm text-muted-foreground">
					<details
						className="min-w-0 flex-1"
						open={mismatch ? true : undefined}
					>
						<summary className="w-fit cursor-pointer hover:text-foreground">
							Build details
						</summary>
						<div className="mt-2 space-y-2">
							<BuildDetails label="Web" info={webBuild} />
							{info.data && <BuildDetails label="Backend" info={info.data} />}
						</div>
					</details>
					<a
						className="hover:text-foreground hover:underline"
						href={`${repository}/blob/main/docs/guide/deployment.md#updates`}
						target="_blank"
						rel="noreferrer"
					>
						Upgrade guide
					</a>
				</div>
			</CardContent>
		</Card>
	);
}
