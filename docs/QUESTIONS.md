# Questions for the owner

The agent adds a question here whenever a task needs a product decision that `DIRECTION.md` does not cover, with
its recommendation. Answer under **Answer** (a line is enough). The next run copies the answer into the decision log
and unblocks the task.

## Open

### Q1. KPay terminal API
- **Needed for:** M4.3, M9.2
- **Question:** Has KPay provided the App ID/Secret, the terminal API spec, supported terminal models and a test
  terminal? Will KPay let a membership partner apply perks at the terminal?
- **Recommendation:** Book the KPay meeting first; until then the agent builds against the mock terminal (M4.1).
- **Answer:**

### Q2. CrewBook integration
- **Needed for:** M8.2, M8.3
- **Question:** Does CrewBook have an API the agent can use (staff and roles out, till sales in)? Can the agent get
  access to its repo or API docs?
- **Recommendation:** A small, versioned API on the CrewBook side: `GET staff`, `POST shift-sales`. The agent can draft
  the contract if you share how CrewBook is built.
- **Answer:**

### Q3. CoHee v1 menu
- **Needed for:** M3.1 real data
- **Question:** The CoHee menu: items, EN/ZH names, prices, sizes and modifiers (milk, sugar, ice, extra shot) with
  any price differences.
- **Recommendation:** Share the current menu board or POS export; the agent will turn it into seed data.
- **Answer:**

### Q4. Online-order rules
- **Needed for:** M6.4
- **Question:** How long until an unpaid online order expires, and how many no-shows switch off make-ahead?
- **Recommendation:** Expire 30 minutes after pickup time; make-ahead only for members with 3+ paid visits; switch it
  off after 2 no-shows in 30 days.
- **Answer:**

### Q5. Loyalty values
- **Needed for:** pilot launch
- **Question:** Confirm the v0.1 proposals: 9 stamps → free drink (café-funded), 10 beans per visit, 1 bean per HK$10.
- **Recommendation:** Keep them for the CoHee pilot and review after 4 weeks of data.
- **Answer:**

### Q6. Brand
- **Needed for:** screen polish before the pilot
- **Question:** Are the theme colours (cream, deep green, orange) and fonts final? Is there a logo file?
- **Answer:**

### Q7. Hosting
- **Needed for:** pilot deployment
- **Question:** Where should the API and Postgres run?
- **Recommendation:** A managed Postgres and app host in a region close to Hong Kong, with daily backups.
- **Answer:**

### Q8. Customer order page technology
- **Needed for:** M6.1
- **Question:** Build the online order page inside the Expo app's web build (shares code and translations), or as a
  separate website?
- **Recommendation:** Expo web, to share menu, i18n and member sign-in code.
- **Answer:**

### Q9. iPad cup reader
- **Needed for:** M7.2
- **Question:** iPads can't use the USB ACR122U the way Android can. Use the stand bridge for iPad cafés, or buy and
  test a Bluetooth NFC reader that supports NTAG 424?
- **Recommendation:** Use the bridge for the pilot; test one Bluetooth reader in parallel.
- **Answer:**

### Q10. Agent self-merges
- **Needed for:** every overnight run (the scheduled task tells the agent to merge its own passing PRs)
- **Question:** The scheduled overnight task says the agent may merge its own PRs when CI is green, a reviewer PASS
  names the head commit, there are no conflicts and no open owner comments. `CLAUDE.md` on main still says "never
  merge your own PR"; the change is in PR #2. On 2026-11-28 05:17 HK the agent merged PR #3 (M0.2) under the
  scheduled task's rule. Do you confirm this practice?
- **Options:** (a) confirm: merge PR #2 so CLAUDE.md matches; (b) reject: the agent only opens PRs and you merge.
- **Recommendation:** (a), keeping the exclusions in the scheduled task (no merges of rule, gate or decision files).
- **Answer:**

## Answered

Answers move into `DIRECTION.md` → Decision log.
