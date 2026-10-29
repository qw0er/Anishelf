import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button.js";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./collapsible.js";

/**
 * Saved configuration is a summary, never evidence of network availability.
 * Callers pass raw buttons; the panel owns one action row so Save, Cancel, Test
 * and More share the same line instead of stacking wrappers. The menu stays
 * last so secondary service actions never sit between primary actions.
 */
export function ConnectionSettings({
	configured,
	label,
	status,
	endpoint,
	children,
	actions,
	menu,
	onCancel,
}: {
	configured: boolean;
	label: string;
	status: string;
	endpoint?: string | null;
	children: ReactNode;
	actions?: ReactNode;
	menu?: ReactNode;
	onCancel?: () => void;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(!configured);
	return (
		<Collapsible open={open} onOpenChange={setOpen} className="group min-w-0">
			<CollapsibleTrigger
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
					className="shrink-0 transition-transform group-data-open:rotate-180"
					aria-hidden="true"
				/>
			</CollapsibleTrigger>
			<CollapsibleContent keepMounted>
				<div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
				{(actions || menu || (configured && onCancel)) && (
					<div className="action-row mt-4">
						{actions}
						{configured && onCancel && (
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									onCancel();
									setOpen(false);
								}}
							>
								{t("actions.cancel")}
							</Button>
						)}
						{menu}
					</div>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
