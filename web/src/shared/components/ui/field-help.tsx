import { Info } from "lucide-react";
import { Tooltip } from "./tooltip.js";

export function FieldHelp({ label, help }: { label: string; help: string }) {
	return (
		<Tooltip content={help} openOnClick>
			<button
				type="button"
				aria-label={label}
				className="icon-control rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				<Info size={14} aria-hidden="true" />
			</button>
		</Tooltip>
	);
}
