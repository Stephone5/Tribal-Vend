# OKC Vending Research — v2
Compiled 2026-09-12. Replaces `okc-operator-intel.md`.
Findings only. No recommendations.

---

## 1. OKLAHOMA LAW — what the state requires

**Vending device decal.** Oklahoma requires a decal on each coin-operated vending device, issued by the Tax Commission.

| Item | Detail |
|---|---|
| Fee | **$75 per machine per year** (cut from $150 by HB signed under Gov. Fallin, effective July 1) |
| Period | **July 1 – June 30** |
| In lieu of | The fee replaces sales tax on that machine's receipts |
| Application must include | Owner name, sales tax permit number, **number and location of devices**, payment |
| Placement | Decal affixed to the device, "plainly visible and readable by the public" |
| Refunds | Unused decals returnable within 30 days, only if a complete device+location list was filed |
| **Card-only exemption** | Since **Nov 1, 2021**, devices taking *only* card/electronic payment are exempt from the fee and decal. Their gross receipts are subject to sales tax instead. |

Authority: 68 O.S. §723, §1501(6), §1503(A)(4); OAC 710:25-1-2, -1-6, -1-8, -1-9.

Two consequences of the decal rule, as written:
- Every legally decaled cash-accepting machine in Oklahoma carries a visible owner identifier.
- The Tax Commission holds a filed list of device counts and locations per operator.

**Blind vendor priority (Oklahoma mini-Randolph-Sheppard).** 7 O.S. §71–78; OAC 612:25-2-1 through 612:25-6-33.
Priority for blind vendors on **state and county** property, covering vending machines, cafeterias, snack bars, cart service. Excluded: fairgrounds, exposition centers, trade/consumer show facilities, pari-mutuel horse racing facilities, parks, golf courses, county-trust hospitals. Municipal property is not named in the statute.
Federal property is covered by the federal Randolph-Sheppard Act (41 CFR §102-74.50) — federal agencies must give blind vendors priority and must notify the state licensing agency of opportunities.

**SBA.** NAICS **454310 / 445132 — Vending Machine Operators.** SBA size standard: **$12.0 million annual receipts.** Vending is an eligible business type for SBA 7(a). No public SBA borrower-level data for OKC vending companies was locatable through open search; SBA loan-level records require the FOIA dataset.

---

## 2. STATE FILING SEARCH — what failed

The Oklahoma Secretary of State entity search at `sos.ok.gov/corp/corpInquiryFind.aspx` returned **zero results for every query**, including known-good names ("VENDING", "TBS SERVICE"). Tried: direct form entry, button click, and a properly-formed ASP.NET async postback with the UpdatePanel headers. Server responded 200 with "Total Results: NA" each time. OpenCorporates, the usual mirror, is behind a CAPTCHA.

**So: no incorporation dates, registered agents, officer names, or good-standing status were obtained from state filings.** Everything below comes from directories, BBB, company sites, and listings.

---

## 3. OPERATORS — OKC metro

Machine counts are not published by any operator. None were found.

| Company | Location | Founded / tenure | Scale signal |
|---|---|---|---|
| **Hayes 405 Refreshments** | 6101 NW 2nd St, OKC | **1939**, by Clayton Hayes, 2 trucks | Largest independent in OKC metro. 9 counties: McClain, Logan, Grady, Kingfisher, Canadian, Pottawatomie, Seminole, Lincoln. Vending + Avenue C micro-markets + coffee + pantry |
| **Canteen** | national, OKC presence | — | National foodservice/vending |
| **TBS Service & Vending Co., LLC** | 537 N Ann Arbor Ave, OKC 73127 | Incorporated **5/5/1999**; local start **8/1/2005** per BBB; site says "since 2004"; ~21 yrs | Owner/founding partner **Tony Curzio**. Routes + machine sales + repair. Claims "combined 50 years of service experience" |
| **Alpha Vending Corporation** | 1220 W Reno Ave; 6608 N Western Ave Ste 414, OKC 73116 | — | Vending + TouchTunes jukeboxes + ATMs + pinball/arcade repair |
| **Blue Sky Supply** | OKC + Tulsa | — | Snack, beverage, coffee, cold food. Listed separately in one directory as "Blue Sky Central," 73127 |
| **ValueOne Vending** | OKC 73116 + Tulsa 74145 | — | Two metros |
| **Imperial LLC** | OKC 73149, Tulsa, Lawton, Muskogee | — | Four branches |
| **Vendmoore Enterprises** | Moore | — | Moore, OKC, Norman, Del City, Edmond. Free install, 24/7 service |
| **ION Vending** | OKC | — | OKC, Edmond, Moore, Yukon. Free machines, **no contracts** |
| **VendVue** | OKC | — | Vending, micro-markets, coffee |
| **Parks Coffee** | OKC 73129 | — | Coffee-led |
| **WhiteFox Vending** | 1002 East Dr, Edmond 73034 | — | No owner name published |
| **Hunt Vending Services** | Tuttle 73089 | — | Supply, install, maintain |
| **Metro Vending** | Tulsa 74146 | **50+ years** | Tulsa |

Outside the metro: Snax Vending (Arkoma), Aeco Sales (Tecumseh), Vend N Things (Tulsa), Green Country Vendors (Tulsa), Harvest Fields (Afton), Hometown Vending (Vinita), Oliver's (Elk City), Southern Vending / Southern Markets (Ardmore).

**Owner ages:** not published for any operator. Only tenure figures above were found.
**Activity levels:** no operator publishes route size, account count, or service frequency. Not obtainable from public sources.

Operators headquartered inside the Airport Wedge quadrant: **none found.**

---

## 4. OPERATOR FORUM — what working vendors say

Source: VENDiscuss Locating Discussions, 37 pages. Quoted below are full-line operators with dated tenure.

**AZVendor** (Arizona, full-line, vending since 1985, 15.5k posts):
- "Skip the schools and hotels. Schools are slow accounts and hotels are nothing but vandalism and both are hard to get into due to competition."
- "Target blue collar locations like auto shops, tire shops, mechanical places, etc."
- "Don't bring up paying a commission to them unless they bring it up. If they do then tell them the price will be higher if you have to pay a commission."
- "You will dictate the machine you will put in because you're supposed to be the professional expert in this business."
- "Snacks take 5 or more machines on location to keep your stales under control so don't get into them too soon."
- "Hotels are hotbeds for vandalism because none of the machines are monitored and the customers are transitory."
- On cold-call vs in-person, asked which is better while doing both: "You're doing it the best way."
- On drive distance: "There's no rule of thumb. The larger you get, the farther you will be willing to drive... work the area close to you really hard to create a compact business model."

**Gizmo Vending** (Texas, full-line, since 2014) on commission:
- "Don't bring it up. If it is brought up then you would roll the commission into your price. For example if you're selling 12 oz cans for $1.25 and you agree on a 10 percent commission then you would do 1.25 x 1.1 and round up or down because vending machines are in 5 cent increments."
- "Now let's say you found a goldmine you could offer a commission to try to keep other vendors at bay."
- On paying for electricity: "any kind of business that would warrant a machine is already going to use a lot of electricity."

**AngryChris** (Ohio, full-line, since 2010):
- "The trick in vending is to maximize your route efficiency. It doesn't matter as much how far the farthest stop is from your home base, what matters is how many stops you can service in one day and how much you can collect."
- "Places around walmarts are usually bad examples because... they are often just lots and lots of retail locations and there is usually fast food everywhere. Industrial parks are usually zoned as such and you'll find lots of factories and blue collar locations which you want."
- On large new accounts: "the big businesses being built are already part of existing companies and the big guys probably already service them... they already had a vendor despite not even breaking ground yet."
- On finding accounts: "You are the best locator because you know what accounts SHOULD be a good fit for your company."
- On competitor displacement: "find competitor's trucks and make notes of the days/times I saw their trucks and follow them around and leave cards. All you need is to find 1 or 2 really bad drivers that offer poor service and leave cards at every location they service."
- "I prefer to focus on locations that have the right headcount and proximity to me above all else."

**Zachsea** (Florida, full-line, since 2011), asking how competitors reach new warehouses first: "we have had 7 new 50-200 employee warehouse operations in the last year... when I contact them it seems to always be too late."

**Bulk-vending script thread** (2009–2022, 63 replies): the recurring technique is a charity-framed pitch. "The most effective pitches are the ones that emphasize the charity and de-emphasizes any sales spiel." Direct mail was reported as failed by two operators — "$50 later in mailing supplies and stamps and no luck"; "Bulk mailings rarely work in vending - been there done that."

**Note on conflict with published guides.** The marketing-site guides cited in the previous report ranked hotels and schools as top-tier locations. The operator forum contradicts both. Commission guidance also conflicts: published guides give 8–12% as standard for mid-size accounts; forum operators say don't raise it at all, and price it in if the location does.

**Published commission benchmarks** (for contrast, from vendor marketing sites): small offices/break rooms 0–5%; mid-size manufacturers, apartments, fitness 8–12%; hospitals, universities, airports, government 15–20%; malls and transit 20–30%.

**Published headcount threshold:** managed vending providers state a 40–50 employee minimum for no-cost placement; some sources cite 25+, others 65–75 with trial periods.

---

## 5. INCUMBENCY CHECK — status

Not completed. Method and result:

- **Map data:** 8 vending machines are mapped within the 3.5-mile radius. All 8 are dog-waste bag dispensers, fuel pumps, or an ice machine. Zero break-room machines. Confirmed unusable.
- **Street View:** not run.
- **Review-text search:** not run.
- **Operator client lists:** no OKC operator publishes named accounts.
- **Tax Commission decal filings:** these contain device counts and locations by operator. Not requested. Availability under the Oklahoma Open Records Act is unverified.

**No location on the prospect list has been confirmed either to have or not have a machine.** The Band A / B / C split in the prior report was inference from headcount, not evidence. It is withdrawn.

---

## 6. PROSPECT DATA — unchanged from v1, not re-pulled

The 198-location list in `okc-prospect-list.md` was not re-pulled for this version. It remains a single Overpass pull dated 2026-09-11. The four phone numbers in it (Heritage Place, Rinker, Trinity, MHC Kenworth) remain single-sourced and unverified against a second source.

---

# FLAGS

## A. Selling a route

| Price | Machines | Locations | Gross/yr | Net/yr | Detail | Status |
|---|---|---|---|---|---|---|
| **$179,000** | 29 | 20 | $151,365 | $67,897 | Soda & snack | Listed |
| **$155,000** | 12 | — | — | — | "Owner is retiring." Proven income history, strong location relationships | Listed |
| **$169,000** | — | — | — | — | Listed as "lucrative vending machine business" | Listed |
| **$99,000** | 35 | 30 | $110,275 | $58,850 | Soda & snack | Listed |
| — | 16 units | — | — | — | Home-based, OKC | Listed |
| $73,000 | 56 (25 combo, 15 snack, 16 drink) + 2002 Workhorse truck + Bunn coffee maker | — | $91,000 | ~$35,000 | 3 days/wk, Mon–Wed 8am–2pm. "Focus on other business opportunities." Contact Jay@therouteexchange.com | Sold |
| $65,000 | 7 | 7 | $50,784 | $18,820 | Retail, senior centers, office. Owner 1 yr, 8–9 hrs/wk. "Other opportunities" | Sold |
| $60,000 | 19 | 16 | $70,393 | $34,081 | Offices, hotel, industrial. Owner 1.5 yrs, ~20 hrs/wk. **Health reasons** | Sold |

Brokers carrying OKC vending: Routes For Sale (1-844-768-8374), The Route Exchange (Jay@therouteexchange.com), RouteRelief, DealStream, BizBuySell, BizQuest, Vending Exchange.

Note: BizBuySell and BizQuest listing pages are bot-blocked. The $179,000, $155,000, $169,000, $99,000 and 16-unit entries come from search result summaries, not from the listing pages themselves.

## B. Wanting a machine

No named Oklahoma business posting a request was found.

- The Vending Club runs a **"Locations Wanted" board** — operator-posted requests, browsable by state and vertical, at `thevendingclub.net/locations-wanted`. The public page is a template; actual listings require membership login. Not accessed.
- VENDiscuss has no locations-wanted board.
- Four OKC operators advertise free placement to businesses that inquire — ION Vending (no contracts), Vendmoore, Blue Sky Supply, Vending Exchange. These are supply-side ads, not businesses seeking machines.

---

## Sources

**Law:** [68 O.S. §723](https://law.justia.com/codes/oklahoma/title-68/section-68-723/) · [OAC 710:25-1-2](https://www.law.cornell.edu/regulations/oklahoma/OAC-710-25-1-2) · [OAC 710:25-1-9](https://www.law.cornell.edu/regulations/oklahoma/OAC-710-25-1-9) · [OTC Coin Decal Catalog 2024](https://oklahoma.gov/content/dam/ok/en/tax/documents/resources/publications/infographics/CoinDecalCatalog-2024.pdf) · [Vending Market Watch — fee cut to $75](https://www.vendingmarketwatch.com/home/news/10266585/oklahoma-cuts-vending-machine-fee-in-half) · [OK mini-Randolph-Sheppard](https://www.publichealthlawcenter.org/resources/mini-randolph-sheppard-acts-50-state-review/ok) · [41 CFR §102-74.50](https://www.law.cornell.edu/cfr/text/41/102-74.50) · [RSA Vending Facility Program](https://rsa.ed.gov/about/programs/randolph-sheppard-vending-facility-program)

**SBA:** [SBA size standards](https://www.sba.gov/federal-contracting/contracting-guide/size-standards) · [SBA table of size standards](https://www.bnl.gov/ppm/docs/sba-table-of-size-standards.pdf) · [NAICS 454310](https://www.naics.com/naics-code-description/?code=454210)

**Forum:** [Tips On Finding Locations](https://vendiscuss.net/topic/38314-tips-on-finding-locations/) · [Do you pay location owners?](https://vendiscuss.net/topic/38387-do-you-pay-location-owners/) · [How Far Do You Drive](https://vendiscuss.net/topic/37158-how-far-do-you-drive/) · [Ways to secure new construction accounts](https://vendiscuss.net/topic/39244-ways-to-secure-new-construction-accounts/) · [Scouting: Cold Calling or In Person?](https://vendiscuss.net/topic/38642-scouting-locations-cold-calling-or-in-person/) · [Locating: Scripts, Objections, Rebuttals](https://vendiscuss.net/topic/4440-locating-scripts-objections-rebuttals-success/)

**Operators:** [Hayes 405](https://hayes405refreshments.com/about/) · [TBS](https://www.tbsvending.com/) · [TBS BBB](https://www.bbb.org/us/ok/oklahoma-city/profile/vending-machine-supplies/tbs-service-vending-co-llc-0995-90009214) · [Alpha Vending](https://www.jukeboxok.com/) · [Blue Sky Supply](https://blueskysupply.net/vending) · [Vendmoore](https://www.vendmoore.com/break-room-vending-services) · [ION Vending](https://ionvending.com/free-vending-machines) · [WhiteFox](https://www.whitefoxvending.com/) · [Vending Club OK directory](https://www.thevendingclub.net/oklahoma/vending-machine-operators)

**Routes:** [Route Exchange OKC](https://therouteexchange.com/oklahoma-city-vending-route-for-sale/) · [RoutesForSale 19-machine](https://www.routesforsale.net/soda-snack-vending-route-oklahoma-city-oklahoma.html) · [RoutesForSale 7-machine](https://www.routesforsale.net/vending-route-oklahoma-city-oklahoma.html) · [RouteRelief OKC](https://routerelief.com/soda-snack-vending-machines-route-oklahoma-city-ok.html) · [DealStream OKC](https://dealstream.com/oklahoma/oklahoma-city/vending-routes-for-sale)
