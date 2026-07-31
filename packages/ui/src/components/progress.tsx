"use client";

import { type Bloom, bloomClass } from "@crm/ui/lib/dither";
import { cn } from "@crm/ui/lib/utils";
import { Progress as ProgressPrimitive } from "radix-ui";
import type * as React from "react";

function Progress({
	className,
	value,
	bloom = "low",
	...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
	bloom?: Bloom;
}) {
	return (
		<ProgressPrimitive.Root
			data-slot="progress"
			className={cn(
				"relative flex h-1 w-full items-center overflow-hidden rounded-none bg-muted",
				className,
			)}
			{...props}
		>
			<ProgressPrimitive.Indicator
				data-slot="progress-indicator"
				className={cn(
					"size-full flex-1 bg-primary transition-all",
					bloomClass(bloom),
				)}
				style={
					{
						transform: `translateX(-${100 - (value || 0)}%)`,
						"--bloom-color": "var(--color-primary)",
					} as React.CSSProperties
				}
			/>
		</ProgressPrimitive.Root>
	);
}

export { Progress };
