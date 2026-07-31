import LogoGithub from "@carbon/icons-react/es/LogoGithub";
import LogoLinkedin from "@carbon/icons-react/es/LogoLinkedin";
import LogoX from "@carbon/icons-react/es/LogoX";
import Money from "@carbon/icons-react/es/Money";
import UserMultiple from "@carbon/icons-react/es/UserMultiple";
import { Button } from "@crm/ui/components/button";
import type { CarbonIcon } from "@crm/ui/components/icon";
import { Icon } from "@crm/ui/components/icon";

export type CompanyLinks = {
	linkedinUrl: string | null;
	twitterUrl: string | null;
	githubUrl: string | null;
	pricingUrl: string | null;
	careersUrl: string | null;
};

/**
 * The website is not in this list — it is the domain in the sheet header,
 * which is a link, because that is what a domain should be. What is left are
 * the places the agent found this company that its name does not give you.
 */
const LINKS: { key: keyof CompanyLinks; label: string; icon: CarbonIcon }[] = [
	{ key: "linkedinUrl", label: "LinkedIn", icon: LogoLinkedin },
	{ key: "twitterUrl", label: "X", icon: LogoX },
	{ key: "githubUrl", label: "GitHub", icon: LogoGithub },
	{ key: "pricingUrl", label: "Pricing", icon: Money },
	{ key: "careersUrl", label: "Careers", icon: UserMultiple },
];

export function hasCompanyLinks(company: CompanyLinks): boolean {
	return LINKS.some((link) => company[link.key] !== null);
}

/**
 * Every link says where it goes.
 *
 * A bare row of glyphs works for LinkedIn and GitHub, whose marks people know,
 * and fails for "pricing" and "careers", which have no mark — so the row comes
 * out half legible and reads as clip art. Labels cost one line and remove the
 * guessing.
 */
export function CompanySocials({ company }: { company: CompanyLinks }) {
	const present = LINKS.flatMap((link) => {
		const href = company[link.key];
		return href ? [{ ...link, href }] : [];
	});

	if (present.length === 0) return null;

	return (
		<div className="flex flex-wrap items-center gap-2">
			{present.map((link) => (
				<Button key={link.key} asChild variant="outline" size="sm">
					<a href={link.href} target="_blank" rel="noreferrer noopener">
						<Icon icon={link.icon} data-icon="inline-start" />
						{link.label}
					</a>
				</Button>
			))}
		</div>
	);
}
