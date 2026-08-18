# Insurix: Build Specification

You are the lead engineer on Insurix. Build this as a production system, not a demo. Every decision below is deliberate. Where I have left something open, choose the option a senior engineer would defend in a design review, and write down why in `docs/decisions/`.

---

## 1. What Insurix is

Insurix tells Indian health insurance policyholders how much of their hospital bill they will actually get back, and why the rest was cut.

Two moments matter:

**Before admission.** A patient is standing at a hospital admission desk choosing a room. Their policy has a room rent sub-limit they have never read. Picking the wrong room triggers a proportionate deduction across the entire claim, not just the room charge. Insurix computes the real out-of-pocket cost of each room option in under 30 seconds.

**After settlement.** The claim was "approved" but the payout is far below the bill. Insurix parses the itemised bill and the settlement or rejection letter, recomputes every deduction independently, flags the ones that look wrong, and drafts the grievance letter with the specific policy clause and regulatory reference attached.

The product is an **audit tool**, not an insurance intermediary. This distinction is legal, not cosmetic. See section 10.

### Who uses it

- A salaried person in a tier 1 or tier 2 city with a retail or employer group mediclaim policy, typically ₹3 lakh to ₹10 lakh cover.
- Often the patient's adult child, handling paperwork while a parent is admitted. They are stressed, on a phone, in a hospital corridor, on poor connectivity.

Design for that person. Not for a desktop user with time.

---

## 2. Non-negotiable engineering constraints

These are hard requirements. Do not deviate without flagging it explicitly.

1. **No hardcoded secrets, endpoints, model names, or credentials.** Everything goes through validated environment configuration. The app must fail loudly at boot if a required variable is missing, never silently at request time.
2. **No mock data in production code paths.** Fixtures live in `tests/fixtures/` and are imported only by test files. If a feature is not ready, it is behind a feature flag and returns an honest empty state, not fake data.
3. **No `any` in TypeScript.** Strict mode on. `noUncheckedIndexedAccess` on. If you need an escape hatch, use `unknown` and narrow it.
4. **Every external boundary is validated at runtime.** API request bodies, API responses, LLM outputs, environment variables, uploaded file contents. Use Zod schemas. Parse, do not cast.
5. **Money is never a float.** All currency is stored and computed as integer paise. Write a `Money` value type with explicit `fromRupees`, `toRupees`, `add`, `subtract`, `multiplyByRatio`, and `allocate` methods. Rounding behaviour must be explicit and tested, including how remainders are distributed when splitting proportionally.
6. **The domain logic is pure and framework free.** The deduction engine must be a standalone TypeScript module with zero imports from Next.js, the database, or the AI provider. It takes plain data in and returns plain data out. This is the part of the codebase that must be right, so it must be trivially testable.
7. **No AI output is trusted.** LLM responses are parsed against a schema, validated against business rules, and every extracted number is traceable to a source region of the uploaded document. If validation fails, surface it to the user as "we could not read this reliably" rather than guessing.
8. **Accessibility is a build requirement.** Keyboard navigable, visible focus states, correct heading order, form labels, `prefers-reduced-motion` respected, colour contrast at WCAG AA minimum. Non-negotiable for a health product.

---

## 3. Stack

Use this unless you have a strong reason not to, in which case document it.

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript | Server components keep sensitive computation off the client |
| Styling | Tailwind CSS v4 with a custom token layer | Tokens in CSS variables, not scattered utility soup |
| Components | Radix primitives, styled in house | Accessibility for free, no visual lock in |
| Database | PostgreSQL | Relational data with real integrity constraints |
| ORM | Drizzle | Typed, close to SQL, migrations you can read |
| Auth | Auth.js v5, email OTP and Google | Phone OTP later, needs a paid provider |
| File storage | S3 compatible, presigned uploads | Documents never pass through the app server |
| Background jobs | A durable queue, not `setTimeout` | Document parsing takes 10 to 60 seconds |
| AI | Anthropic API via a provider abstraction | See section 7 |
| Validation | Zod | One schema library everywhere |
| Testing | Vitest, Playwright | Unit for domain, E2E for the two critical flows |
| Errors | Structured logging with request correlation IDs | You will need this when a claim calculation is disputed |

Everything runs locally with `docker compose up` plus `pnpm dev`. A new engineer should be productive in under ten minutes. Write the README that makes that true.

---

## 4. The deduction engine

This is the core of the product. Build this first, before any UI, and drive it entirely with tests.

### The mechanism to model

An Indian mediclaim policy typically caps the eligible room rent, either as a rupee amount per day or as a percentage of sum insured. If the patient occupies a room above that cap, many policies apply a **proportionate deduction**: certain other charges in the claim are paid only in the ratio of eligible room rent to actual room rent.

The critical thing most people miss is that this ratio is applied to a category of associated expenses, not only to the room charge itself. That is how a ₹7,000 per day room gap turns into a deduction many times larger.

### Why this must be a rule engine, not a formula

The rules vary by insurer, by policy, and by year. Following the IRDAI Master Circular on Health Insurance Business dated 29 May 2024, several insurers changed or removed proportionate deduction clauses, and the set of expense categories exempt from the ratio differs between policies. Some policies exempt pharmacy, implants, and diagnostics. Some exempt nothing. Some waive the deduction entirely when the lower room category was unavailable.

**Therefore: do not hardcode a single formula.** Build a versioned, data-driven rule engine.

### Required design

```
domain/
  money/            Money value type, allocation, rounding
  billing/          BillLine, LineCategory, Bill aggregate
  policy/           PolicyTerms, SubLimit, Exclusion, WaitingPeriod
  rules/
    engine.ts       Pure evaluator: (Bill, PolicyTerms, RuleSet) -> Settlement
    ruleset.ts      RuleSet type and versioning
    rules/          Individual rule implementations
  settlement/       Settlement, Deduction, DeductionReason
```

Every rule implements a common interface and returns not just a number but a **reason object**:

```ts
interface DeductionReason {
  ruleId: string;
  ruleVersion: string;
  humanExplanation: string;      // Plain language, shown to the user
  clauseReference?: string;      // Policy section, if known
  regulatoryReference?: string;  // Circular reference, if applicable
  affectedLineIds: string[];
  amountDeducted: Money;
  confidence: 'certain' | 'likely' | 'uncertain';
}
```

A `Settlement` is the ordered list of deductions applied to a bill, plus the final payable amount. **Every rupee of difference between bill total and payable must be attributable to exactly one reason.** Write a test that asserts this invariant holds for every fixture. If the reasons do not sum to the difference, the engine has a bug and must throw, not round it away.

Rule ordering matters and is itself part of the RuleSet, because applying a sub-limit before or after a proportionate ratio gives different answers. Make ordering explicit and versioned.

### Rules to implement in v1

- Room rent sub-limit, absolute and percentage-of-sum-insured variants
- Proportionate deduction, with a configurable set of exempt line categories
- ICU sub-limit, which often has a separate cap
- Non-medical and consumable exclusions, driven by a seeded reference list
- Per-procedure or per-disease sub-limits
- Co-payment, applied at the correct stage relative to other deductions
- Sum insured exhaustion
- Waiting period and pre-existing disease flags, which produce warnings rather than computed deductions since they require clinical judgement

### The reverse mode

The same engine runs backwards. Given a real settlement letter showing what the insurer actually deducted, compute what the deductions should have been, and produce a **variance report**: line items where the insurer's figure and yours disagree, with the delta and your reasoning. This variance report is the product's core artifact. It is what a user attaches to a grievance letter.

Be honest in the variance report. If your engine is uncertain, say so. A confident wrong number in a legal document is far worse than a flagged uncertainty.

---

## 5. Features

### 5.1 Room Decision (pre-admission, the hero flow)

The user has a policy on file. They are at a hospital. They enter or scan the room tariff card. Insurix shows, for each room option, the estimated total out-of-pocket cost given an estimated bill size, not just the room rate.

Requirements:
- Must work on a phone in under 30 seconds from opening the app
- Must work on poor connectivity: optimistic UI, local computation where possible, queued sync
- Estimated bill size comes from a procedure lookup with a visible range, never a fake precise number
- Output states its assumptions plainly and lets the user adjust them
- Shareable as an image or PDF, because the user will show it to a family member on WhatsApp

### 5.2 Policy Intake

The user uploads their policy schedule PDF. The system extracts sum insured, room rent limits, ICU limits, co-pay, sub-limits, waiting periods, and the proportionate deduction clause.

Requirements:
- Extraction is reviewed by the user before it is trusted. Show every extracted field next to the source snippet it came from, and let the user correct it. Never silently accept extraction output.
- Store the corrected version as the source of truth and the raw extraction separately, so you can measure extraction accuracy over time
- Support multi-file uploads: schedule, policy wording, endorsements
- A manual entry path must exist for every field, for when extraction fails

### 5.3 Bill Audit

Upload an itemised hospital bill. The system parses it into structured line items, categorises each line, runs the engine, and produces the settlement projection with the full deduction breakdown.

Requirements:
- Line categorisation is reviewable and correctable, same principle as policy intake
- Flag lines that look anomalous against reference ranges, clearly marked as a flag and not an accusation
- Handle the real world: photographed bills, skewed scans, multi page, dot matrix print, mixed English and regional language

### 5.4 Settlement Variance and Grievance Draft

Upload the settlement or rejection letter. Produce the variance report. If there are disputable deductions, draft a grievance letter.

Requirements:
- The draft cites specific policy clauses and, where applicable, regulatory provisions
- **The draft is never auto-filed and never auto-sent.** It is generated, shown, editable, downloadable. The user sends it themselves.
- Every claim made in the letter must trace back to a computed deduction with a reason object. No unsupported assertions.
- A prominent, non-dismissible notice that this is a computed audit and not legal advice
- Escalation path shown as information: insurer grievance officer, then the regulator's complaint channel, then the Insurance Ombudsman. Present it as a sequence with what each step requires. Do not promise outcomes.

### 5.5 The dataset (build the plumbing, do not surface it yet)

Every processed bill and settlement is a data point: which insurer, which deduction ground, what amount, what fraction of the claim. Nobody has this data at scale, including the regulator, which collects overall repudiation rates but not per-claim reasons.

Build the anonymised aggregation pipeline from day one. Strict separation: identifiable claim records in one schema, anonymised aggregates in another, with the join key deliberately destroyed. This is the long term moat and the compliance risk, so build it correctly rather than retrofitting it.

---

## 6. Data model notes

- Users, policies, claims, documents, extractions, settlements, deductions, rule sets
- A claim references a **rule set version**, so a settlement computed six months ago can be reproduced exactly. Never mutate a rule set in place, always version it.
- Documents store: storage key, checksum, MIME type, page count, upload time, processing status, and a retention expiry
- Extractions store the raw model output alongside the user-corrected version, with a diff. This gives you an accuracy metric for free.
- Full audit log for every computation: inputs, rule set version, outputs, timestamp. If a user takes a variance report to an Ombudsman, you must be able to reproduce exactly what the system said and when.
- Soft delete everywhere, with a hard delete job for retention expiry

---

## 7. AI integration

### The abstraction

Never call the Anthropic SDK directly from a route handler or component. All model access goes through:

```ts
interface DocumentExtractor {
  extract<T>(input: ExtractionRequest<T>): Promise<ExtractionResult<T>>;
}
```

Behind that interface: retries with backoff, timeouts, token accounting, structured logging, and a cost ceiling per request. Model identifiers come from configuration, never from a string literal in application code.

### Extraction rules

- Every extraction request specifies a Zod schema. The response is parsed against it. Parse failure triggers one retry with the validation error fed back, then a hard failure surfaced to the user.
- Every extracted field must carry a **provenance**: the page number and, where possible, the region of the document it came from. The UI renders this so the user can verify.
- Every extracted field carries a confidence. Low confidence fields are highlighted for review, not silently accepted.
- Prompts live in versioned files under `lib/ai/prompts/`, not inline in application code. Changing a prompt is a reviewable diff.
- Log the prompt version with every extraction so you can attribute accuracy changes.

### The hard boundary

The model extracts and drafts. **The model never computes money.** Every rupee figure in the product comes from the deterministic engine in section 4. If you find yourself asking the model to add up numbers or apply a percentage, you have made an architecture mistake. Fix it rather than working around it.

### Cost and abuse control

Per user rate limits. Per request cost ceiling. A daily spend cap that degrades gracefully rather than failing open. File size and page count limits enforced before any model call.

---

## 8. Design direction

The client has rejected templated proposals. This needs a real visual identity.

### Grounding

The subject's world is the itemised bill: a long column of line items, a right aligned column of figures, a rule, a total. The whole promise of the product is "we read the line items you did not." So make **tabular figures and the ledger column the visual centre of the product**, not a decorative afterthought. Numbers are the content here. Treat them like it.

### Palette

Six values, and derive everything from them:

- `--paper` `#FCFCFA` warm off-white ground
- `--ink` `#14181C` near black, all primary text
- `--pine` `#0E4F4A` deep institutional green, primary actions and trust surfaces
- `--cut` `#B3261E` the deduction signal, money removed from your claim
- `--recovered` `#1B7F5A` money that comes back
- `--rule` `#DDE1E0` hairlines, dividers, table borders

`--cut` is used for one thing only: money lost. Never for errors, never for destructive buttons, never decoratively. Its scarcity is what gives it weight. When a user sees red in Insurix, it means rupees.

### Type

- **Display:** Archivo, at Expanded width for headlines. Confident, slightly technical, not a serif and not another Inter.
- **Body:** IBM Plex Sans.
- **Data:** IBM Plex Mono, tabular figures enabled, for every rupee amount in the product without exception.

The Plex choice is functional, not aesthetic: the family includes IBM Plex Sans Devanagari, so Hindi support later is a drop in rather than a rebuild. Build the token layer assuming Devanagari is coming.

Set a real type scale with intentional weights. Amounts are always monospace, always right aligned, always with tabular figures so digits do not jitter when values update.

### The signature element: the Deduction Waterfall

This is what the product is remembered by. The bill total sits at the top as a single large monospace figure. As the user scrolls, each deduction peels away in sequence: the amount drops, a line item slides out to the left with its plain language reason and clause reference, and the running total updates. It ends on the amount the user actually receives.

It is honest, it is the product's entire thesis made visible, and it is the thing someone screenshots and sends to a friend. Build it carefully. It should feel like watching money leave, because that is what it is.

Respect `prefers-reduced-motion`: the reduced version shows the same breakdown as a static table with the same information, no motion, no information loss.

### Restraint

Spend the boldness on the waterfall. Everything else stays quiet: generous whitespace, hairline rules, no gradients, no shadows beyond a single subtle elevation token, no rounded corners above 6px. This is a product about money and accuracy. It should feel like a well set financial document, not a consumer app trying to be friendly.

### Copy

- Plain verbs, sentence case, no filler
- Name things by what the user controls: "Check a room" not "Initiate room analysis"
- Never sell in the interface. State what happens.
- Errors say what went wrong and what to do about it. They do not apologise and they are never vague.
- Empty states are invitations to act, not decoration
- The tone is a competent friend who reads contracts. Not a chatbot, not a lawyer, not a brand.

Write the copy as design material. Bad copy will make a good design feel templated.

---

## 9. Quality bar

- Domain layer at 90 percent plus test coverage, with property based tests for the Money allocation logic
- Playwright E2E covering the two flows that matter: room decision, and bill upload through to variance report
- A golden fixture suite: real world bill and policy shapes with hand verified expected settlements. When a rule changes, these tell you what broke.
- CI runs typecheck, lint, unit, E2E, and a build on every push
- Lighthouse: performance above 90 on mobile, accessibility 100
- Error boundaries at every route segment with useful recovery, not a blank screen
- Loading states that show real progress for the 10 to 60 second document parse, not an indefinite spinner

---

## 10. Compliance and safety

Take this seriously. It is the part that can end the product.

**Health data.** Hospital bills and policy documents are sensitive personal data under India's Digital Personal Data Protection Act, 2023. Encrypt at rest and in transit. Minimum retention with an automatic deletion job. Explicit consent at upload, stating what is stored and for how long. A working data export and account deletion flow, built in v1 and not deferred.

**Positioning.** Insurix audits documents the user already has. It does not sell, solicit, or service insurance products, and it does not act as an agent, broker, or intermediary. Keep it that way in both the product and the copy. Route every naming and flow decision through this test: does this look like we are acting on the insurer's or the policyholder's behalf in the claim, or like we are reading documents for the user? Only the second is safe without a licence.

**Never do these things:**
- Never file, submit, or send anything to an insurer on the user's behalf
- Never state a guaranteed outcome or recovery amount
- Never present a computed projection as a certainty. It is an estimate from the documents provided, and the interface must say so where the number appears, not only in a footer.
- Never present the grievance draft as legal advice

**Fee model.** If a contingency fee is ever introduced, that is a regulatory question to resolve before writing the billing code, not after. Build the billing abstraction to support both subscription and per-audit pricing, and leave contingency unimplemented.

---

## 11. Build order

Do not build this breadth first. Build it in this order and make each stage genuinely work before moving on.

1. **Repo, tooling, CI, environment validation, README.** Boring, and everything else depends on it.
2. **Money type and the deduction engine, test driven, with no UI at all.** This is the product. Get it right in isolation.
3. **Golden fixture suite.** Hand verified cases before you have a UI to hide behind.
4. **Database schema, migrations, seed data** including the non-medical exclusions reference list.
5. **Auth, upload pipeline, presigned S3, job queue.**
6. **AI extraction layer** with schema validation and provenance.
7. **Policy intake with the review and correct interface.**
8. **Room Decision flow.** First user facing value.
9. **Bill audit and the Deduction Waterfall.**
10. **Settlement variance and grievance draft.**
11. **Anonymised aggregation pipeline.**
12. **Polish pass:** accessibility audit, performance, empty and error states, copy review.

---

## 12. How to work

- Before writing UI code, produce a short design plan: tokens, type scale, layout concept, and the waterfall's interaction spec. Check it against section 8. If any part of it is what you would produce for any generic fintech page, change it and say what you changed.
- Commit in logical units with real messages.
- Record architectural decisions in `docs/decisions/NNN-title.md`: context, decision, consequences. Short.
- When you hit something genuinely ambiguous, especially in the regulatory rules, do not guess and move on. Implement the configurable version, note the assumption in `docs/assumptions.md`, and flag it in your summary so I can verify it against real policy wordings.
- Maintain `docs/verify-before-launch.md`: every claim the product makes about insurance rules that needs checking against a real policy document or regulation before this goes near a real user.

The last point matters most. The engine's correctness is the entire product. A beautiful interface computing the wrong deduction is worse than nothing, because someone will take it to an Ombudsman.
