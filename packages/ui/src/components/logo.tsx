import type * as React from "react";

const Logo = (props: React.SVGProps<SVGSVGElement>) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width={512}
		height={512}
		viewBox="0 0 512 512"
		fill="none"
		{...props}
		aria-label="Fastrack Logo"
	>
		<rect width="512" height="512" rx="96" fill="#080b53" />
		<path
			d="M150 120h240v56H222v88h150v56H222v128h-72z"
			fill="#ffffff"
		/>
	</svg>
);
export default Logo;
