import { Info } from "lucide-react";
import { Tooltip } from "./tooltip.js";

export function FieldHelp({ label, help }: { label: string; help: string }) {
	return (
		<Tooltip content={help} openOnClick>
			<button
				type="button"
				aria-label={label}
				className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<Info size={14} aria-hidden="true" />
			</button>
		</Tooltip>
	);
}
