import Launch from "@carbon/icons-react/es/Launch";
import LogoGithub from "@carbon/icons-react/es/LogoGithub";
import LogoLinkedin from "@carbon/icons-react/es/LogoLinkedin";
import LogoX from "@carbon/icons-react/es/LogoX";
import Money from "@carbon/icons-react/es/Money";
import UserMultiple from "@carbon/icons-react/es/UserMultiple";
import { Button } from "@crm/ui/components/button";
import type { CarbonIcon } from "@crm/ui/components/icon";
import { Icon } from "@crm/ui/components/icon";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";

type Link = { label: string; href: string | null; icon: CarbonIcon };

/**
 * Everywhere else this company exists, as found by the agent.
 *
 * Renders nothing until there is something to render — an empty row of
 * placeholder icons says "broken", not "not enriched yet".
 */
export function CompanySocials({
	company,
}: {
	company: {
		website: string | null;
		linkedinUrl: string | null;
		twitterUrl: string | null;
		githubUrl: string | null;
		pricingUrl: string | null;
		careersUrl: string | null;
	};
}) {
	const links: Link[] = [
		{ label: "Website", href: company.website, icon: Launch },
		{ label: "LinkedIn", href: company.linkedinUrl, icon: LogoLinkedin },
		{ label: "X", href: company.twitterUrl, icon: LogoX },
		{ label: "GitHub", href: company.githubUrl, icon: LogoGithub },
		{ label: "Pricing", href: company.pricingUrl, icon: Money },
		{ label: "Careers", href: company.careersUrl, icon: UserMultiple },
	];

	const present = links.filter(
		(link): link is Link & { href: string } => link.href !== null,
	);

	if (present.length === 0) return null;

	return (
		<div className="flex flex-wrap items-center gap-1">
			{present.map((link) => (
				<Tooltip key={link.label}>
					<TooltipTrigger asChild>
						<Button asChild variant="ghost" size="icon-sm">
							<a href={link.href} target="_blank" rel="noreferrer noopener">
								<Icon icon={link.icon} />
								<span className="sr-only">{link.label}</span>
							</a>
						</Button>
					</TooltipTrigger>
					<TooltipContent>{link.label}</TooltipContent>
				</Tooltip>
			))}
		</div>
	);
}
