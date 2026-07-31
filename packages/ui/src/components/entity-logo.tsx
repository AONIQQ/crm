"use client";

import { initialsFromName } from "@crm/ui/lib/format";
import { cn } from "@crm/ui/lib/utils";
import { useState } from "react";

export type EntityLogoSize = "xs" | "sm" | "default" | "lg" | "xl";

/**
 * A square logo tile with an initials fallback.
 *
 * Square rather than an `Avatar`: a round crop is right for a face and wrong
 * for a wordmark, and company logos arrive from Context.dev as squares already.
 * Keeping it here rather than composing it per module means a company reads the
 * same in a table row, a sheet header and an embedded list.
 */
export function EntityLogo({
	src,
	name,
	size = "default",
	className,
}: {
	src?: string | null;
	name: string;
	size?: EntityLogoSize;
	className?: string;
}) {
	// The *url* that failed, not a boolean: enrichment fills `iconUrl` in behind
	// a poll, so a `true` left over from the placeholder would pin this to
	// initials forever once the real logo arrived.
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	// Whether the artwork is a square mark or a wide wordmark. Both arrive
	// through the same field and neither is tagged, so it is measured on load.
	// The fit is always `contain` — cropping a logo is never the right answer —
	// but a wordmark letterboxed edge to edge in a bordered tile reads as
	// broken, so a wide one gets breathing room and a square one does not.
	const [wide, setWide] = useState(false);

	const url = src?.trim() ? src : null;
	const showImage = url !== null && failedSrc !== url;

	return (
		<span
			data-slot="entity-logo"
			data-size={size}
			className={cn(
				"inline-flex size-8 shrink-0 select-none items-center justify-center overflow-hidden border bg-card text-center font-medium text-muted-foreground text-xs uppercase leading-none",
				"data-[size=xs]:size-5 data-[size=xs]:text-[9px] data-[size=sm]:size-6 data-[size=sm]:text-[10px] data-[size=lg]:size-10 data-[size=lg]:text-sm data-[size=xl]:size-14 data-[size=xl]:text-lg",
				!showImage && "bg-muted",
				className,
			)}
		>
			{showImage ? (
				<img
					src={url}
					alt=""
					loading="lazy"
					decoding="async"
					// Several logo CDNs refuse a request that carries our origin.
					referrerPolicy="no-referrer"
					onLoad={(event) => {
						const { naturalWidth, naturalHeight } = event.currentTarget;
						if (!naturalHeight) return;
						setWide(naturalWidth / naturalHeight > 1.2);
					}}
					// A dead logo URL is common — brands move them — and the alt text of
					// a broken image is worse than the initials we would have shown.
					onError={() => setFailedSrc(url)}
					className={cn("size-full object-contain", wide && "p-[3px]")}
				/>
			) : (
				initialsFromName(name)
			)}
		</span>
	);
}
