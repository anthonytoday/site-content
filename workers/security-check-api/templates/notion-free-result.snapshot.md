Here is the result of "fetch" for the Page with URL https://app.notion.com/p/3fef028b623e81119386c5d5bb6e3b08 as of 2026-10-19T05:45:25.722Z:
<page url="https://app.notion.com/p/3fef028b623e81119386c5d5bb6e3b08" icon="🛡️">
<ancestor-path>
<parent-page url="https://app.notion.com/p/fb8ab85c15fb4d9699cebb06f8b146d6" title="Templates"/>
<ancestor-2-page url="https://app.notion.com/p/3fdf028b623e818a8f2be5d2f46ab74f" title="Notion Workspace Security Check: One-Pager"/>
</ancestor-path>
<properties>
{"title":"TEMPLATE: Free Security Check Result"}
</properties>
<iconMetadata>{"type":"emoji","emoji":"🛡️"}</iconMetadata>
<content>
<span color="gray">**FREE RESULT**</span><span color="gray"> · Notion Workspace Security Check · Prepared for \{\{#if company\}\}\{\{company\}\}\{\{else\}\}your workspace\{\{/if\}\} · \{\{report_date\}\}</span>
<callout icon="💬" color="gray_bg">
	**Talk to Anthony:** [Website](https://www.anthonytoday.com) · [WhatsApp](https://wa.me/33695845150) · [Email](mailto:admin@anthonytoday.com) · [LinkedIn](https://www.linkedin.com/in/anthony-kieffer/)
</callout>
---
## Executive Summary
We checked how \{\{#if company\}\}\{\{company\}\}'s Notion workspace\{\{else\}\}your Notion workspace\{\{/if\}\} (\{\{team_size\}\} people, \{\{plan\}\} plan) handles sign-in, sharing, connected apps, people, admin rights and recovery. It sits at Level \{\{overall_level_number\}\}, \{\{overall_level\}\} (\{\{overall_score\}\}/100): \{\{strength_summary\}\}, but \{\{top_risks_summary\}\} leave gaps. \{\{biggest_impact_sentence\}\}
<callout icon="📊" color="orange_bg">
	**Overall Level**
	<span color="orange">**Level \{\{overall_level_number\}\}, \{\{overall_level\}\}**</span>
	Score \{\{overall_score\}\} / 100. Your level comes from your weakest areas, not the average.
</callout>
<callout icon="🎯" color="gray_bg">
	**Main Risk**
	\{\{main_risk\}\}
</callout>
## Domain Profile
<table fit-page-width="true" header-row="true">
<tr>
<td>Area</td>
<td>Profile</td>
<td>Score</td>
<td>Level</td>
</tr>
<tr>
<td>1. Identity and Access</td>
<td>\{\{area_identity_bar\}\}</td>
<td>\{\{area_identity_score\}\}</td>
<td>\{\{area_identity_level\}\}</td>
</tr>
<tr>
<td>2. Sharing and Data Exposure</td>
<td>\{\{area_sharing_bar\}\}</td>
<td>\{\{area_sharing_score\}\}</td>
<td>\{\{area_sharing_level\}\}</td>
</tr>
<tr>
<td>3. Integrations and Third Parties</td>
<td>\{\{area_integrations_bar\}\}</td>
<td>\{\{area_integrations_score\}\}</td>
<td>\{\{area_integrations_level\}\}</td>
</tr>
<tr>
<td>4. People and Offboarding</td>
<td>\{\{area_people_bar\}\}</td>
<td>\{\{area_people_score\}\}</td>
<td>\{\{area_people_level\}\}</td>
</tr>
<tr>
<td>5. Governance and Admin</td>
<td>\{\{area_governance_bar\}\}</td>
<td>\{\{area_governance_score\}\}</td>
<td>\{\{area_governance_level\}\}</td>
</tr>
<tr>
<td>6. Resilience and Recovery</td>
<td>\{\{area_resilience_bar\}\}</td>
<td>\{\{area_resilience_score\}\}</td>
<td>\{\{area_resilience_level\}\}</td>
</tr>
</table>
<span color="gray">Legend: </span>
- <span color="gray">Level 4 - Hardened (80 to 100)</span>
- <span color="gray">Level 3 - Managed (60 to 79)</span>
- <span color="gray">Level 2 - Basic (30 to 59)</span>
- <span color="gray">Level 1 - Exposed (0 to 29)</span>
## How You Compare
<span color="gray">Recommendations only, no benchmark data.</span>
- **Recommended Level for a Team Your Size:** \{\{recommended_level\}\} in every area. This is our recommendation for a team of \{\{team_size\}\}, based on controls Notion itself documents for teams, not a statistic:
	- 2-step verification for every person. Notion says it "highly recommends" it. [Notion help](https://www.notion.com/help/two-step-verification)
	- Access given through teamspaces and groups, not person by person. [Notion guide](https://www.notion.com/help/guides/grant-access-teamspaces)
	- Sensitive teamspaces closed, guests kept out of them, and public pages kept in one place. [Notion guide](https://www.notion.com/help/guides/grant-access-teamspaces)
	- Guests limited to the pages they work on, and removed when the work ends. [Notion help](https://www.notion.com/help/whos-who-in-a-workspace)
	- You're there in \{\{areas_at_recommended_count\}\} of 6 areas today. \{\{areas_below_recommended\}\} \{\{below_recommended_verb\}\} short.
- **Compared With Other Teams:** switches on once 30 or more teams have completed the Security Check.
	- \{\{#if peer_comparison_enabled\}\}\{\{peer_comparison_text\}\}\{\{else\}\}<span color="gray">Available once 30 or more teams have completed the Security Check.</span>\{\{/if\}\}
\{\{#if flags\}\}
## Critical Flags
<callout icon="🚩" color="red_bg">
	\{\{flags\}\}
</callout>
\{\{/if\}\}
## Every Risk We Found
\{\{#if strengths\}\}
- **What's working:** \{\{strengths\}\}
\{\{/if\}\}
### Priority Risks
\{\{priority_risks\}\}
### Other Risks to Watch (\{\{other_risk_count\}\}) {toggle="true"}
	\{\{risk_list\}\}
## Two Quick Wins (5 Minutes Each)
1. **See what's public.** Open any published page, select Share → Publish → All published sites, and Unpublish anything you don't recognize. Unpublishing doesn't remove "Anyone on the web with link" on a page, so check that in Share → General access too. [Notion help](https://www.notion.com/help/public-pages-and-web-publishing)
2. **Turn on 2-step verification.** Settings → your name → Account security → 2-step verification → Add verification method. Use an authenticator app, save the backup codes, and ask your team to do the same. [Notion help](https://www.notion.com/help/two-step-verification)
## Already in Your \{\{plan\}\} Plan
\{\{#if plan_features_unused\}\}
- Based on your answers, these features are included in your plan but not yet working for you:
	\{\{plan_features_unused\}\}
\{\{/if\}\}
## What the Fix List Adds
<table fit-page-width="true" header-row="true" header-column="true">
<tr>
<td>What You Get</td>
<td>**Free Result**<br>Included</td>
<td>**Fix List**<br>\$39</td>
</tr>
<tr>
<td>Score, level and 6-area profile</td>
<td><span color="green">✅</span></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>Every risk named, with why it matters</td>
<td><span color="green">✅</span></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>2 quick wins</td>
<td><span color="green">✅</span></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>Step-by-step fix for every risk, with the exact Notion menus</td>
<td></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>What each fix means on your \{\{plan\}\} plan, and the workaround when a control is Enterprise only</td>
<td></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>Top 3 risks explained: impact on your business</td>
<td></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>Action plan database: owner role, phases, timeline view</td>
<td></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>All 12 answers with scores</td>
<td></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>**Price**</td>
<td>**Free**</td>
<td>**\$39**</td>
</tr>
</table>
<callout icon="🛡️" color="blue_bg">
	**Get your Fix List for \$39.** Delivered by email right after payment. 7-day refund on request. [Get the Fix List](https://buy.stripe.com/28E6oJfmMbYh27h4Kt1ZS0x?client_reference_id={{result_id}})
</callout>
---
➡️ [Book on WhatsApp](https://wa.me/33695845150) · [Email](mailto:admin@anthonytoday.com)
---
<span color="gray">Self-check based on your answers. General guidance, not a formal audit.</span>
---
Prepared by Anthony, Notion Certified Consultant, [www.anthonytoday.com](https://www.anthonytoday.com)
</content>
</page>