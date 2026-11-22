---
name: lab-results-review
description: Use when the user shares blood/lab test results or asks which tests to take: interpret vs reference ranges, record them, suggest follow-up tests and prepare a lab order.
---

# Lab results review

Not a doctor. Explain, prioritise and prepare questions for the doctor; never diagnose or prescribe beyond common over-the-counter guidance.

Personal settings (preferred lab, branch, ordering steps, where to file results, language) live in the user's private data repo. If a private skill with the same name exists there, follow it on top of this one.

## Reading results
1. Extract every value with its unit and the lab's own reference range (`pdftotext -layout`). Flag out-of-range values (often marked `*`).
2. For each flagged value: how far off (mild / moderate / marked), the 2-3 most common benign causes, context that could explain it (recent infection, alcohol, training, sleep, supplements), and the follow-up a GP would usually order.
3. Check the user's supplements before any dosing advice; ask for the composition if unknown.
4. Always list the red flags relevant to the symptoms that mean "see a doctor now, don't wait".
5. Reply short: what is off, what to do, when to retest. One caveat line, no lecturing.

## Common follow-ups (adults, general guidance)
- Vitamin D 25-OH 50-75 nmol/L (insufficiency): D3 ~1000-2000 IU/day with a fatty meal, retest in ~3 months. Below 50: the doctor decides the dose.
- Ferritin mildly high with normal CBC/CRP: acute-phase reaction, alcohol or liver; avoid iron supplements; GP plus serum iron, transferrin saturation, ALT/AST/GGT.
- Ferritin below 30: iron deficiency; GP, look for the cause.
- Fatigue work-up basics: CBC, CRP, TSH (+ free T4), B12, iron panel, ALT/AST/GGT, fasting glucose. Skip what was recently normal.

## Recording
- Store results with date, lab and order number, plus the interpretation, in the private data repo.
- Close the matching "take tests" task; add tasks for the doctor visit and the retest; put supplements on the shopping list (see `data/README.md` for the item format).

## Ordering tests
- Compare bundles ("complexes", "panels") with single tests; pick the cheaper set that covers everything. Read real prices; never guess.
- Lab sites often sit behind bot protection: use a real browser on the user's computer rather than fetching from the cloud.
- You may fill the cart. The user passes any human check, enters personal data, places the order and pays.
