"use client";

import { initialsFromName } from "@crm/ui/lib/format";
import { cn } from "@crm/ui/lib/utils";
import { useState } from "react";

export type EntityLogoSize = "xs" | "sm" | "default" | "lg" | "xl";

/**
 * How the artwork behaves against a background, as resolved at enrichment time.
 *
 * - `opaque` — composed on its own tile; needs nothing from us.
 * - `dark`   — dark mark on transparency; vanishes in dark mode.
 * - `light`  — light mark on transparency; vanishes in light mode.
 */
export type EntityLogoTone = "opaque" | "dark" | "light";

/**
 * A surface, only for the theme where the artwork would otherwise disappear.
 *
 * Most brands publish one logo drawn for a white page, so on a dark row a black
 * wordmark is simply not there. The alternative — a tile behind every logo —
 * is what the note above rules out, and it would put a white square behind the
 * icons that already arrive on their own background.
 *
 * `invert` rather than a coloured tile for the monochrome cases: it keeps the
 * mark borderless, which is the whole point of this component, and a mark whose
 * dominant colour is near-black or near-white is monochrome by definition.
 */
const TONE_CLASS: Record<EntityLogoTone, string> = {
	opaque: "",
	dark: "dark:invert",
	light: "invert dark:invert-0",
};

/**
 * A square logo tile with an initials fallback.
 *
 * Square rather than an `Avatar`: a round crop is right for a face and wrong
 * for a wordmark, and company logos arrive from Context.dev as squares already.
 * Keeping it here rather than composing it per module means a company reads the
 * same in a table row, a sheet header and an embedded list.
 *
 * One format for every logo, and no chrome around it. A border drawn around
 * artwork that already carries its own edge — which is most of them, since the
 * icons arrive pre-composed on a brand colour — reads as a box the logo is
 * trapped in, and turns a column of companies into a strip of frames. Without
 * it the artwork is the artwork: contained, never cropped, and occupying the
 * same square whatever shape it came in.
 */
export function EntityLogo({
	src,
	darkSrc,
	tone,
	name,
	size = "default",
	className,
}: {
	src?: string | null;
	/** The brand's own dark-mode artwork, when it publishes one. */
	darkSrc?: string | null;
	tone?: EntityLogoTone | null;
	name: string;
	size?: EntityLogoSize;
	className?: string;
}) {
	// The *url* that failed, not a boolean: enrichment fills `iconUrl` in behind
	// a poll, so a `true` left over from the placeholder would pin this to
	// initials forever once the real logo arrived.
	const [failedSrc, setFailedSrc] = useState<string | null>(null);

	const url = src?.trim() ? src : null;
	const dark = darkSrc?.trim() ? darkSrc : null;
	const showImage = url !== null && failedSrc !== url;

	// A real dark-mode logo always beats a synthetic one, so the tone fix is
	// skipped entirely when the brand published artwork for both.
	const toneClass = dark ? "" : tone ? TONE_CLASS[tone] : "";

	return (
		<span
			data-slot="entity-logo"
			data-size={size}
			className={cn(
				"inline-flex size-8 shrink-0 select-none items-center justify-center overflow-hidden text-center font-medium text-muted-foreground text-xs uppercase leading-none",
				"data-[size=xs]:size-5 data-[size=xs]:text-[9px] data-[size=sm]:size-6 data-[size=sm]:text-[10px] data-[size=lg]:size-10 data-[size=lg]:text-sm data-[size=xl]:size-14 data-[size=xl]:text-lg",
				// Initials are type, and type needs a surface to sit on to read as a
				// logo's stand-in rather than as two stray letters in the row.
				// Artwork brings its own.
				!showImage && "bg-muted",
				className,
			)}
		>
			{showImage ? (
				<>
					<img
						src={url}
						alt=""
						loading="lazy"
						decoding="async"
						// Several logo CDNs refuse a request that carries our origin.
						referrerPolicy="no-referrer"
						// A dead logo URL is common — brands move them — and the alt text
						// of a broken image is worse than the initials we would have shown.
						onError={() => setFailedSrc(url)}
						// `contain`, always: cropping a logo is never the right answer, and
						// with no border to letterbox against, a wide wordmark can use the
						// full width instead of being inset to escape the frame.
						//
						// Swapped by CSS rather than by reading the theme in JS: a hook
						// would render the wrong logo on the server and flip it on hydrate.
						className={cn(
							"size-full object-contain",
							dark && "dark:hidden",
							toneClass,
						)}
					/>

					{dark ? (
						<img
							src={dark}
							alt=""
							loading="lazy"
							decoding="async"
							referrerPolicy="no-referrer"
							className="hidden size-full object-contain dark:block"
						/>
					) : null}
				</>
			) : (
				initialsFromName(name)
			)}
		</span>
	);
}
