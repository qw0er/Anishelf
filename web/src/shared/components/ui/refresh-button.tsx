import { RefreshCw } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "./button.js";
import { Tooltip } from "./tooltip.js";

export function RefreshButton({
	label,
	busy = false,
	disabled,
	onClick,
	...props
}: Omit<
	ComponentProps<typeof Button>,
	"children" | "aria-label" | "aria-busy"
> & {
	label: string;
	busy?: boolean;
}) {
	return (
		<Tooltip content={label}>
			<Button
				variant="ghost"
				size="icon"
				className="text-muted-foreground"
				{...props}
				aria-label={label}
				aria-busy={busy}
				disabled={disabled || busy}
				onClick={(event) => {
					console.debug("[RefreshButton] Refresh requested.");
					onClick?.(event);
				}}
			>
				<RefreshCw
					size={16}
					className={busy ? "motion-safe:animate-spin" : undefined}
					aria-hidden="true"
				/>
			</Button>
		</Tooltip>
	);
}
