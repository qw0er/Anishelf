import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button.js";

/** Saved configuration is a summary, never evidence of network availability. */
export function ConnectionSettings({
	configured,
	label,
	status,
	endpoint,
	children,
	actions,
	onCancel,
}: {
	configured: boolean;
	label: string;
	status: string;
	endpoint?: string | null;
	children: ReactNode;
	actions?: ReactNode;
	onCancel?: () => void;
}) {
	const { t } = useTranslation();
	return (
		<details open={!configured || undefined} className="group min-w-0">
			<summary
				aria-label={label}
				className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-md py-2 text-sm [&::-webkit-details-marker]:hidden"
			>
				<span className="min-w-0 flex-1">
					<span
						className="block truncate font-medium"
						title={endpoint ?? undefined}
					>
						{endpoint || status}
					</span>
					{endpoint && (
						<span className="text-xs text-muted-foreground">{status}</span>
					)}
				</span>
				<span className="text-muted-foreground">{label}</span>
				<ChevronDown
					size={16}
					className="shrink-0 transition-transform group-open:rotate-180"
					aria-hidden="true"
				/>
			</summary>
			<div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
			{actions && (
				<div className="mt-4 flex flex-wrap items-center gap-2">
					{actions}
					{configured && onCancel && (
						<Button
							type="button"
							variant="ghost"
							onClick={(event) => {
								onCancel();
								const details = event.currentTarget.closest("details");
								if (details) details.open = false;
							}}
						>
							{t("actions.cancel")}
						</Button>
					)}
				</div>
			)}
		</details>
	);
}
