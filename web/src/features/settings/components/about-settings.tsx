import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import changelog from "../../../../../CHANGELOG.md?raw";
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
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../../../shared/components/ui/collapsible.js";
import { toast } from "../../../shared/components/ui/toast.js";

declare const __ANISHELF_BUILD__: BuildInfo;
const webBuild = __ANISHELF_BUILD__;
const repository = "https://github.com/qw0er/Anishelf";
const updateKey = ["system", "updates"];
const releases = changelog
	.split(/^## /m)
	.slice(1)
	.map((section) => {
		const [version = "", ...body] = section.split("\n");
		return { version: version.trim(), body: body.join("\n").trim() };
	});

function BuildDetails({ label, info }: { label: string; info: BuildInfo }) {
	const { t, i18n } = useTranslation();
	return (
		<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
			<span className="w-14 shrink-0 font-medium text-foreground">{label}</span>
			<span>
				v{info.version} · {info.channel}
			</span>
			{info.commit && <code className="break-all">{info.commit}</code>}
			{info.builtAt && (
				<span>
					{t("about.built", {
						time: new Date(info.builtAt).toLocaleString(i18n.language),
					})}
				</span>
			)}
		</div>
	);
}

export function AboutSettings() {
	const { t, i18n } = useTranslation();
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
		onMutate: () => toast.close("update-check"),
		mutationFn: () => request<UpdateCheck>("/api/system/updates/check", "POST"),
		onSuccess: (result) => {
			client.setQueryData(updateKey, result);
			toast.add({
				id: "update-check",
				type: "info",
				title: t(`about.status.${result.status}`),
			});
		},
		onError: () => {
			console.warn("[Settings] Update check failed.");
			toast.add({
				id: "update-check",
				type: "error",
				title: t("about.checkFailed"),
				actionProps: {
					children: t("actions.retry"),
					onClick: () => check.mutate(),
				},
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
		<div className="stack-page">
			<Card className="settings-section lg:grid">
				<CardHeader>
					<CardTitle>Anishelf</CardTitle>
					<CardDescription>{t("about.description")}</CardDescription>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
						{[
							[t("about.project"), repository],
							[t("about.docs"), `${repository}/tree/main/docs/guide`],
							[t("about.issues"), `${repository}/issues`],
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
							label={t("about.checkUpdates")}
							shortLabel={t("about.check")}
							variant="outline"
							aria-busy={check.isPending}
							disabled={check.isPending || !info.data}
							onClick={() => check.mutate()}
						/>
					</div>
					{info.isPending && (
						<p className="text-sm text-muted-foreground" role="status">
							{t("about.loadingBackend")}
						</p>
					)}
					{info.isError && (
						<p className="field-error" role="alert">
							{t("about.backendFailed")}{" "}
							<button
								type="button"
								className="underline"
								onClick={() => void info.refetch()}
							>
								{t("actions.retry")}
							</button>
						</p>
					)}
					{mismatch && (
						<p role="alert" className="field-error">
							{t("about.mismatch")}
						</p>
					)}
					{updates.data && (
						<div
							className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
							aria-live="polite"
						>
							<span>{t(`about.status.${updates.data.status}`)}</span>
							{updates.data.latest && (
								<a
									className="underline underline-offset-4"
									href={updates.data.latest.url}
									target="_blank"
									rel="noreferrer"
								>
									{updates.data.latest.version} · {t("about.releaseNotes")}
								</a>
							)}
							<span className="text-xs text-muted-foreground">
								{t("about.checked", {
									time: new Date(updates.data.checkedAt).toLocaleString(
										i18n.language,
									),
								})}
							</span>
						</div>
					)}

					<div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t pt-3 text-sm text-muted-foreground">
						<Collapsible
							className="min-w-0 flex-1"
							key={String(mismatch)}
							defaultOpen={mismatch}
						>
							<CollapsibleTrigger className="w-fit cursor-pointer hover:text-foreground">
								{t("about.buildDetails")}
							</CollapsibleTrigger>
							<CollapsibleContent keepMounted>
								<div className="mt-2 space-y-2">
									<BuildDetails label={t("about.web")} info={webBuild} />
									{info.data && (
										<BuildDetails label={t("about.backend")} info={info.data} />
									)}
								</div>
							</CollapsibleContent>
						</Collapsible>
						<a
							className="hover:text-foreground hover:underline"
							href={`${repository}/blob/main/docs/guide/deployment.md#updates`}
							target="_blank"
							rel="noreferrer"
						>
							{t("about.upgradeGuide")}
						</a>
					</div>
				</CardContent>
			</Card>
			<Card className="settings-section lg:grid">
				<CardHeader>
					<CardTitle>{t("about.changelog")}</CardTitle>
					<CardDescription>
						{t("about.changelogVersion", { version: webBuild.version })}
					</CardDescription>
				</CardHeader>
				<CardContent className="min-w-0 lg:max-w-2xl">
					{!releases.some(
						(release) => release.version === webBuild.version,
					) && (
						<p className="text-sm text-muted-foreground">
							{t("about.changelogMissing")}
						</p>
					)}
					<div className="space-y-6 text-sm">
						{releases.map((release) => (
							<section key={release.version} className="space-y-2">
								<h2 className="section-title">
									{release.version}
									{release.version === webBuild.version &&
										` · ${t("about.installed")}`}
								</h2>
								<Markdown
									components={{
										h3: ({ children }) => (
											<h3 className="mt-3 font-medium">{children}</h3>
										),
										ul: ({ children }) => (
											<ul className="list-disc space-y-1 pl-5">{children}</ul>
										),
										a: ({ href, children }) => (
											<a
												className="underline underline-offset-4"
												href={href}
												target="_blank"
												rel="noreferrer"
											>
												{children}
											</a>
										),
									}}
								>
									{release.body}
								</Markdown>
							</section>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
