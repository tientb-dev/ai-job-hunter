# CV Matching Golden Dataset

The Golden Dataset is a deterministic regression suite. It covers 30 synthetic
CV/JD scenarios (S01–S30) from the final CV Matching beta audit, re-run after
PR #71. The fixtures are the exact synthetic CV lines, JD requirements and model
quotes used in that audit; none are reconstructed.

Suite: [`apps/api/test/unit/cv-match.golden-dataset.spec.ts`](../apps/api/test/unit/cv-match.golden-dataset.spec.ts)

## Run it

```bash
cd apps/api
pnpm -s test:compile
node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.js \
  --runInBand .test-dist/test/unit/cv-match.golden-dataset
```

It also runs as part of `pnpm -r --workspace-concurrency=1 run test` and CI.

## Testing approach

- **Offline.** There are no Gemini or Ollama calls and no API keys. Each
  scenario supplies a controlled model proposal (the quote).
- **Both validation paths:**
  - _GEMINI_: quotes are restricted server-side to the allowed CV passages;
  - _OLLAMA_: no allowed-passage set.
- **What is asserted:** requirement status and credit (not the overall fit
  score), exact quote provenance, agreement between the two paths, and five
  identical repetitions.
- **Failure messages** name the scenario ID, the path and the rationale.
- **Compound requirements** use one quote per component.

## Policy classes

- **CURRENT (26):** the approved beta policy.
- **PROPOSED (4: S08, S27, S29, S30):** desired future behaviour. These assert
  today's accepted conservative result (Not Matched). They are documented
  limitations, not failures. Changing one requires a PO decision, not a test
  edit.

## Accepted beta limitations

All of these fail closed: they can lower a score but never add unsupported
credit, except L4, which is a known risk.

| ID  | Limitation                                                                                                                                | Pinned by        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| —   | RESTful↔REST and K8s↔Kubernetes are not equivalent                                                                                        | S08, S29         |
| —   | Fixed work-verb vocabulary ("configured", "processed" are not accepted)                                                                   | S27              |
| —   | Wraps without a bullet marker are not joined                                                                                              | S30              |
| L1  | Model-dependent selection: familiarity from a skills list needs the model to quote it (no recovery from skills lists)                     | characterization |
| L2  | AND components get no recovery when the model omits their quotes                                                                          | characterization |
| L3  | Descriptive phrases need their exact key words (no synonyms)                                                                              | characterization |
| L4  | The older "<phrase> experience" suffix form still trusts the model-selected passage (outside PR #71 scope); **known false-positive risk** | characterization |
| L5  | Descriptive components of compound requirements need their exact phrase                                                                   | characterization |

The characterization tests pin current behaviour so that any change is made
deliberately; they are not endorsements of that behaviour.
