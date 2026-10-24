# Fifty diverse CRC agent evaluation scenarios

The canonical dataset is [cases.json](cases.json). A readable, generated catalog lists every prompt, expected tool plan, fixture facts and human-review criteria in [CASE-CATALOG.md](../docs/evaluation/CASE-CATALOG.md).

This suite evaluates the **model-mediated agent** through `/api/crc/agent-stream`. It does not score a model's private reasoning, and its results should not be described as a pure foundation-model benchmark. Tool validation, database adapters and response templates affect the outcome.

## Coverage

Exactly **50 distinct prompts** across **10 categories**, with **5 cases per category**:

| Category | Different behaviors tested |
|---|---|
| Dataset scope | Aggregate facts, empty forms, Chinese summary, freshness, monitoring preparation |
| Subject identity | Exact ID, sparse subject, nonexistent ID, partial ID, absent conversational reference |
| Source retrieval | AE rows, legitimate zero, medication rows, total vs display limit, empty form |
| Consent evidence | Enrolled scope, source references, missing-row interpretation, exact-time limitations, unsupported signature verification |
| Composition | Two domains, three tasks, repeated tools with different IDs, negative scope, retrieval + calculation |
| Calendar reasoning | Late visit, inclusive boundary, leap day and early visit, impossible date, missing protocol window |
| Data quality | Subject-specific blanks, global blanks, unknown field, missing field name, absent visit schedule |
| Query workflow | Unsent draft, missing finding, nonexistent participant, prohibited send, prohibited EDC correction |
| Language and intent | Chinese terminology, typos, mixed-language field names, greeting, prescribing boundary |
| Adversarial boundaries | Instruction override, SQL injection, secret exfiltration, invented export tool, compliance certification pressure |

All original ten executable atoms are covered. The later fifteen clinical atoms have separate function tests and a [clinical smoke evaluation](../docs/evaluation/clinical-model-results.json); the original baseline is preserved rather than relabeled as a current score. Cases deliberately mix successful tasks, clarification, transparent tool failures, safe refusals and no-tool social responses. Some alternate plans are accepted when a generic source reader is equivalent to a domain-specific atom. Changing only the participant ID is not treated as the primary source of variety.

## Run

Start the synthetic demo and the desired model first; see the root README.

```bash
npm run eval:model
# Selected dimensions / cases:
npm run eval:model -- --category adversarial_boundaries --out temp/security-eval.json
npm run eval:model -- --ids CRC-014,CRC-023,CRC-029 --out temp/selected-eval.json
npm run eval:model -- --limit 5 --out temp/quick-eval.json
npm run eval:docs
```

The default report is `docs/evaluation/model-50-results.json`. Use `--out` for separate repeats or model comparisons so the recorded baseline is preserved. `AGENT_URL` can point to another **synthetic** instance. Each request has a 190-second client timeout; the suite runs sequentially so a local model is not overloaded. The report is checkpointed after every completed case.

The runner verifies the synthetic server flag and the expected fixture: 6 subjects, 46 forms, 41 stored records and 2 consent findings. It refuses a mismatched dataset. Do not run this public adversarial suite against a real clinical environment.

## What is scored

**System automatic pass:** HTTP and terminal event correctness; acceptable tool-call multiset; exact required parameter values; outcome status; golden factual patterns; structured source rows/counts when specified; bounded retrieval arguments; no returned rows outside the requested IDs; read-only logged SQL; explicit boundary language for refusals; and case-specific unsupported-claim patterns.

**Model-mediated task pass:** all automatic checks pass **and** the log confirms a valid model-selected plan. A successful local rules fallback is reported as a system pass but **never** counted as model success. A no-tool clarification or refusal can count as model-mediated success when the model actually selected the zero-call plan.

**Human review:** every case carries a rubric. Interpretation quality, clinically appropriate caution, completeness of the explanation and subtle unsupported claims require review. The runner always marks this `pending`; regex matches cannot establish clinical safety. Passing automatic checks is not a clinical validation or proof of perfect intent understanding.

Repeated tool calls are matched as a multiset with their parameter sets: two calls for `01-001` cannot pass a request for `01-001` plus `01-003`. Extra calls fail the expected-plan check. Source-row checks use the synthetic fixture, not generated model prose.

## Honest interpretation

- These are development scenarios authored with knowledge of the implementation, **not a held-out test set**. Passing all cases would not demonstrate generalization.
- Clinical wording and refusal behavior may fail even when the tool sandbox prevents side effects. Model behavior and architectural containment are different findings.
- False negatives from narrow textual checks are possible. Review recorded answers before categorizing a failure as a model defect. Do not change expected facts or add alternate plans merely to improve the score.
- `modelSelected` means the model's plan passed validation. A rejected or unavailable plan is labeled fallback by the current server; the evaluator cannot distinguish those causes without additional instrumentation.
- The scoring code and dataset have separate automated integrity tests. CI runs those tests without requiring Ollama or paid API calls. The 50 live scenarios are an explicit evaluation command, not 50 trivial unit tests.
- No agent prompt or tool implementation was tuned as part of adding this baseline suite. Future changes should be compared against the recorded run and an independently authored held-out set.

The report records a SHA-256 of the exact dataset, model/provider configuration, timestamps, per-case latency, executed calls, answers, source rows and failed checks. It omits verbose duplicated SQL; the application execution log still contains actual statements. All persisted examples use generated synthetic data.
