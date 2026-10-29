import { useTranslation } from "react-i18next";
import type { ProfileCatalogIssue } from "../api/contracts.js";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./ui/collapsible.js";

export function ProfileIssueNotice({
	kind,
	issue,
}: {
	kind: "transcode" | "acquisition";
	issue: ProfileCatalogIssue;
}) {
	const { t } = useTranslation();
	return (
		<div
			role="alert"
			className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
		>
			<p className="font-medium">{t(`profileIssue.${kind}Title`)}</p>
			<p className="mt-1 text-muted-foreground">
				{t(`profileIssue.${kind}Description`)}
			</p>
			<p className="mt-1 text-xs text-muted-foreground">
				<code className="break-all">{issue.file}</code>
			</p>
			{issue.detail && (
				<Collapsible className="mt-2">
					<CollapsibleTrigger className="cursor-pointer text-xs text-muted-foreground">
						{t("profileIssue.details")}
					</CollapsibleTrigger>
					<CollapsibleContent keepMounted>
						<p className="mt-1 break-words text-xs text-muted-foreground">
							{issue.detail}
						</p>
					</CollapsibleContent>
				</Collapsible>
			)}
			<p className="mt-2 text-xs text-muted-foreground">
				{t("profileIssue.fixAndRestart")}
			</p>
		</div>
	);
}
