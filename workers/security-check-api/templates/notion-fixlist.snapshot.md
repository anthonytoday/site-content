Here is the result of "fetch" for the Page with URL https://app.notion.com/p/3fef028b623e811b934cfebfe7589542 as of 2026-10-19T07:34:13.630Z:
<page url="https://app.notion.com/p/3fef028b623e811b934cfebfe7589542" icon="🛡️">
<ancestor-path>
<parent-page url="https://app.notion.com/p/fb8ab85c15fb4d9699cebb06f8b146d6" title="Templates"/>
<ancestor-2-page url="https://app.notion.com/p/3fdf028b623e818a8f2be5d2f46ab74f" title="Notion Workspace Security Check: One-Pager"/>
</ancestor-path>
<properties>
{"title":"TEMPLATE: Security Check Fix List"}
</properties>
<iconMetadata>{"type":"emoji","emoji":"🛡️"}</iconMetadata>
<content>
<span color="gray">**FIX LIST REPORT**</span><span color="gray"> · Notion Workspace Security Check · Prepared for \{\{#if company\}\}\{\{company\}\}\{\{else\}\}your workspace\{\{/if\}\} · \{\{report_date\}\}</span>
<callout icon="💬" color="gray_bg">
	**Talk to Anthony:** [Website](https://www.anthonytoday.com) · [WhatsApp](https://wa.me/33695845150) · [Email](mailto:admin@anthonytoday.com) · [LinkedIn](https://www.linkedin.com/in/anthony-kieffer/)
</callout>
---
## Executive Summary
We reviewed how \{\{#if company\}\}\{\{company\}\}'s Notion workspace\{\{else\}\}your Notion workspace\{\{/if\}\} (\{\{team_size\}\} people, \{\{plan\}\} plan) handles sign-in, sharing, connected apps, people, admin rights and recovery. It sits at Level \{\{overall_level_number\}\}, \{\{overall_level\}\} (\{\{overall_score\}\}/100). \{\{good_shape_sentence\}\}\{\{gaps_sentence\}\}\{\{biggest_impact_sentence\}\}
<callout icon="📊" color="orange_bg">
	**Overall Level**
	<span color="orange">**Level \{\{overall_level_number\}\}, \{\{overall_level\}\}**</span>
	Average score \{\{overall_score\}\}/100. Your level is set by your lowest area, so it can be lower than your average suggests.
</callout>
<callout icon="🎯" color="gray_bg">
	**Main Risk**
	\{\{main_risk\}\}
	**Do First:** \{\{do_first\}\}
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
![Maturity level of 5 (filled per result)](https://security-check.security-check-preview.pages.dev/assets/img/security-check/maturity-level-3.png)
<span color="gray">Your overall level is your lowest area.</span>
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
## Top 3 Risks
#### 1. \{\{risk_1_title\}\} {toggle="true"}
	- **Control:** \{\{risk_1_control\}\} (\{\{risk_1_question\}\}, score \{\{risk_1_score\}\}/10).
	- **Why it matters:** \{\{risk_1_why\}\}
	- **Impact:** \{\{risk_1_impact\}\}
	- **Fix:** \{\{risk_1_fix\}\}
	- **Plan note:** \{\{risk_1_plan_note\}\} \{\{risk_1_source_link\}\}
#### 2. \{\{risk_2_title\}\} {toggle="true"}
	- **Control:** \{\{risk_2_control\}\} (\{\{risk_2_question\}\}, score \{\{risk_2_score\}\}/10).
	- **Why it matters:** \{\{risk_2_why\}\}
	- **Impact:** \{\{risk_2_impact\}\}
	- **Fix:** \{\{risk_2_fix\}\}
	- **Plan note:** \{\{risk_2_plan_note\}\} \{\{risk_2_source_link\}\}
#### 3. \{\{risk_3_title\}\} {toggle="true"}
	- **Control:** \{\{risk_3_control\}\} (\{\{risk_3_question\}\}, score \{\{risk_3_score\}\}/10).
	- **Why it matters:** \{\{risk_3_why\}\}
	- **Impact:** \{\{risk_3_impact\}\}
	- **Fix:** \{\{risk_3_fix\}\}
	- **Plan note:** \{\{risk_3_plan_note\}\} \{\{risk_3_source_link\}\}
# Action Plan
Items are ordered by impact, so the first ones close your biggest risk: \{\{risk_1_title_lower\}\}. Each item is one clear action with an owner role, and its full how-to sits inside the item's own page.
<database url="https://app.notion.com/p/66ef028b623e826d889a8177a187e730" inline="true" data-source-url="collection://090f028b-623e-830a-a790-87771191a643">Top 3 Risk Fixes</database>
<span color="gray">Phase 1 and Phase 2 are dated. Phase 3 follows when your team has capacity. Open the Timeline tab for the Gantt view.</span>
<span color="gray">This plan covers your top 3 risks. Detail on the lower-priority items is available as an extra option through the Security Fix Session or Notion Security Hardening.</span>
## Choose Your Next Step (Optional)
<span color="gray">Pick one: do it together, or have it done for you.</span>
<table fit-page-width="true" header-row="true" header-column="true">
<tr>
<td>What You Get</td>
<td>**Your Fix List**<br>Included</td>
<td>**Option A: Security Fix Session**<br>Do it together</td>
<td>**Option B: Notion Security Hardening**<br>Done for you</td>
</tr>
<tr>
<td>Score, maturity profile and critical flags</td>
<td><span color="green">✅</span></td>
<td><span color="green">✅</span></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>Action plan with owners, dates and how</td>
<td><span color="green">✅</span></td>
<td><span color="green">✅</span></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>90-minute live session with Anthony</td>
<td></td>
<td><span color="green">✅</span></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>Top 3 risks closed together, live</td>
<td></td>
<td><span color="green">✅</span></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>All fixes applied for you</td>
<td></td>
<td></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>Full access review and one-page access map</td>
<td></td>
<td></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>30-day re-check</td>
<td></td>
<td></td>
<td><span color="green">✅</span></td>
</tr>
<tr>
<td>**Price**</td>
<td>**\$39, already paid**</td>
<td>**\$290**</td>
<td>**\$1,490**, up to 25 people</td>
</tr>
<tr>
<td>**Book**</td>
<td></td>
<td>[Book Fix Session](https://buy.stripe.com/6oUcN7fmMgex6nxa4N1ZS0y)</td>
<td>[Start Hardening](https://buy.stripe.com/cNiaEZ3E4bYhbHR90J1ZS0z)</td>
</tr>
</table>
---
➡️ [Book on WhatsApp](https://wa.me/33695845150) · [Email](mailto:admin@anthonytoday.com)
---
## Keep It Fixed: Notion Expert as a Service
- Security slides back as your team changes. This monthly service gives your workspace an owner, whichever path you choose above.
<table fit-page-width="true" header-row="true">
<colgroup>
<col>
<col width="470">
</colgroup>
<tr>
<td>What Usually Goes Wrong</td>
<td>What We Do About It</td>
</tr>
<tr>
<td>Nobody owns the workspace</td>
<td>Anthony acts as your part-time Notion owner: one call a month, plus async answers and fixes in between.</td>
</tr>
<tr>
<td>New hires and leavers</td>
<td>Access set up on day one and removed on the last day, with your team, as part of the async fixes.</td>
</tr>
<tr>
<td>Permissions drifting</td>
<td>A quarterly re-check and access review, compared with this report, so the score doesn't slide back.</td>
</tr>
<tr>
<td>New Notion features unused</td>
<td>On the monthly call, we flag new features in your plan that fit how you work and set up the useful ones as small builds.</td>
</tr>
<tr>
<td>Public pages, guests and apps creeping back</td>
<td>Checked every quarter as part of the re-check.</td>
</tr>
<tr>
<td>Small fixes waiting for months</td>
<td>Async fixes and small builds handled within the month.</td>
</tr>
</table>
- **Special Offer:** 
	- \$347/mo founding rate for the first 5 clients, then \$490/mo. Cancel any time. [Start Notion Expert as a Service](https://buy.stripe.com/9B6fZj1vW4vP13d7WF1ZS0u) 
	- Annual: \$2,970/year, billed once a year.
<empty-block/>
<span color="gray">Self-check based on your answers. General guidance, not a formal audit.</span>
---
Prepared by Anthony, Notion Certified Consultant, [www.anthonytoday.com](https://www.anthonytoday.com)
## Appendix
#### All 12 Answers {toggle="true"}
	<table fit-page-width="true" header-row="true">
<tr>
<td>#</td>
<td>Domain</td>
<td>Control</td>
<td>Your Answer</td>
<td>Score</td>
</tr>
<tr>
<td>Q1</td>
<td>Identity</td>
<td>Strong sign-in</td>
<td>\{\{q1_answer\}\}</td>
<td>\{\{q1_score\}\}</td>
</tr>
<tr>
<td>Q2</td>
<td>Identity</td>
<td>One person, one account</td>
<td>\{\{q2_answer\}\}</td>
<td>\{\{q2_score\}\}</td>
</tr>
<tr>
<td>Q3</td>
<td>Sharing</td>
<td>Public exposure</td>
<td>\{\{q3_answer\}\}</td>
<td>\{\{q3_score\}\}</td>
</tr>
<tr>
<td>Q4</td>
<td>Sharing</td>
<td>Secrets in pages</td>
<td>\{\{q4_answer\}\}</td>
<td>\{\{q4_score\}\}</td>
</tr>
<tr>
<td>Q5</td>
<td>Integrations</td>
<td>Connected apps</td>
<td>\{\{q5_answer\}\}</td>
<td>\{\{q5_score\}\}</td>
</tr>
<tr>
<td>Q6</td>
<td>Integrations</td>
<td>AI tool access</td>
<td>\{\{q6_answer\}\}</td>
<td>\{\{q6_score\}\}</td>
</tr>
<tr>
<td>Q7</td>
<td>People</td>
<td>Leavers</td>
<td>\{\{q7_answer\}\}</td>
<td>\{\{q7_score\}\}</td>
</tr>
<tr>
<td>Q8</td>
<td>People</td>
<td>Access review</td>
<td>\{\{q8_answer\}\}</td>
<td>\{\{q8_score\}\}</td>
</tr>
<tr>
<td>Q9</td>
<td>Governance</td>
<td>Admin rights</td>
<td>\{\{q9_answer\}\}</td>
<td>\{\{q9_score\}\}</td>
</tr>
<tr>
<td>Q10</td>
<td>Governance</td>
<td>Default access</td>
<td>\{\{q10_answer\}\}</td>
<td>\{\{q10_score\}\}</td>
</tr>
<tr>
<td>Q11</td>
<td>Resilience</td>
<td>Recovery readiness</td>
<td>\{\{q11_answer\}\}</td>
<td>\{\{q11_score\}\}</td>
</tr>
<tr>
<td>Q12</td>
<td>Resilience</td>
<td>Restore and change history</td>
<td>\{\{q12_answer\}\}</td>
<td>\{\{q12_score\}\}</td>
</tr>
	</table>
	<span color="gray">Scoring: A 10, B 6, C 2, "I don't know" 0. Total \{\{points_earned\}\} / \{\{points_possible\}\} = \{\{overall_score\}\} / 100.</span>
</content>
</page>
