import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

export function Tooltip({
	children,
	content,
}: {
	children: ReactElement;
	content: ReactNode;
}) {
	return (
		<TooltipPrimitive.Root>
			<TooltipPrimitive.Trigger render={children} />
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Positioner sideOffset={6} className="z-50">
					<TooltipPrimitive.Popup
						data-slot="tooltip-content"
						className="max-w-xs rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-md"
					>
						{content}
					</TooltipPrimitive.Popup>
				</TooltipPrimitive.Positioner>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	);
}
