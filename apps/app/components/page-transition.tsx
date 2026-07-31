import type * as React from "react";
import { ViewTransition } from "react";

// Every transition is opt-in by name: "none" means the new view swaps in with
// no animation. A page only moves when a <Link transitionTypes={[...]}> names
// one of these, so navigation stays still by default.
const directional = {
	"nav-forward": "nav-forward",
	"nav-back": "nav-back",
	"nav-lateral": "nav-lateral",
	default: "none",
} as const;

const enter = {
	"nav-forward": "nav-forward",
	"nav-back": "nav-back",
	"nav-lateral": "nav-lateral",
	default: "none",
} as const;

export function PageTransition({ children }: { children: React.ReactNode }) {
	return (
		<ViewTransition
			enter={enter}
			exit={directional}
			update={directional}
			default="none"
		>
			{children}
		</ViewTransition>
	);
}
