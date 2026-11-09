# Qwen3 4B versus 8B — P6/P7 benchmark

2026-11-06 (Asia/Saigon). Recommendation: retain **qwen3:4b** as the default.
Both models produced correct final P6 classifications on this small sample; 8B
showed no consistent quality advantage and took about 2.1× the median workflow
time, with substantially less VRAM headroom. No configuration change was made.

## Scope and repeatability

- Main revision: `4eb3dd8bb8f0c51dddde4f2f0cd71e8907ec79ae`.
- Ollama 0.40.10; RTX 4060, 8,188 MiB reported VRAM; WSL2 reported 15,863 MiB RAM.
- `qwen3:4b`, 4.0B, **Q4_K_M**, digest
  `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`.
- `qwen3:8b`, 8.2B, **Q4_K_M**, digest
  `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`.
- Four synthetic CV–JD pairs × two sequential repetitions × two models:
  **16 workflows**, each P6 analyze followed by P7 suggest. All completed;
  **32 structured generations / 64 generation HTTP requests**, including the
  one-token prompt measurement pass. No retries or extra warmup requests.
- Both use unchanged `JobMatchService`, `MatchingService`, `AiService`, evidence
  validation, scoring, snapshot and suggestion policy. Repository substitutes
  expose only `findOne`, `findOneBy` and `get`: no database initialization or writes.
- Production `OllamaProvider` pins 4B. The standalone adapter permits either model
  while retaining temperature 0, think false, truncate/shift false, 8,192 context,
  measured 2,048–4,096 output budget, schema-constrained JSON, 120-second timeout,
  prompt-count consistency and allocation/digest checks. It normalizes only the
  envelope model name when reusing `validateGeneration`; generated text is intact.
  This is a service-workflow comparison, not production-provider acceptance of 8B.
- Models run sequentially, unloading the benchmark models between model groups
  and after completion. Runtime residency changed; model files/configuration did
  not. Only local loopback Ollama was accessed; no private sources or `.env` read.

Repeat from repository root (runs live inference again):

```bash
pnpm --filter @ai-job-hunter/api test:compile
node docs/audits/qwen-model-benchmark.probe.mjs
```

The probe writes `/tmp/ai-job-hunter-qwen-benchmark/results.json`.
The [retained synthetic results](fixtures/qwen-model-benchmark-results.json)
contain exact inputs, raw outputs, classifications, cards, timings and allocations.

## Inputs and semantic results

Architecture uses the existing `p67-synthetic-and-match.json` input. Database
inputs come from `cv-match.proficiency-ai-semantics.spec.ts`; Rust is the existing
unsupported preferred-skill control. The exact strings are retained in results.

| Pair            | Evidence and JD                                                                                                                                                          | Expected and observed, both models in both repetitions                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| AND/OR          | Designed REST APIs, service integrations and CI/CD; built MCP servers. JD requires five architecture components; prefers MCP or knowledge graphs.                        | Architecture Partial, 3/5 (60%); MCP OR Matched, knowledge graphs Unknown. Overall score 70. |
| SQL work        | Skills mention + “Developed enterprise features using SQL Server.” + generic MyBatis optimization. JD requires proficiency in MySQL, Oracle OR SQL Server; prefers Rust. | Database Partial (50% credit); Rust Unknown. No borrowed MyBatis proficiency.                |
| SQL proficiency | “Independently designed SQL Server database schemas for a production billing application.” Same database JD.                                                             | Database Matched through SQL Server alone; MySQL, Oracle and Rust remain Unknown.            |
| SQL keywords    | “Skills: SQL Server, Oracle, MySQL”. Same database JD.                                                                                                                   | Database Unknown, zero credit; Rust Unknown. Mentions remain visible as observations.        |

`EVIDENCED` is UI Matched; `NOT_EVIDENCED` is UI Unknown. These statuses are
server-derived: the model proposes evidence, not final classifications.

| Measure                                                               |                        qwen3:4b |                        qwen3:8b |
| --------------------------------------------------------------------- | ------------------------------: | ------------------------------: |
| Completed workflows / correct parent-status vectors                   |                             8/8 |                             8/8 |
| Correct parent classifications                                        |                           16/16 |                           16/16 |
| Raw nonempty CV quotes absent from source                             |                               0 |                               0 |
| Unsupported final claims / invalid suggestion evidence spans observed |                               0 |                               0 |
| Median P6 latency                                                     |                          3.14 s |                          7.17 s |
| Median P7 latency                                                     |                          0.58 s |                          0.62 s |
| Median P6 + P7 workflow latency                                       |                      **3.70 s** |                      **7.81 s** |
| Median workflow excluding first cold workflow                         |                          2.81 s |                          7.75 s |
| First cold workflow / reported aggregate load time                    |                 9.65 s / 2.99 s |                14.81 s / 3.85 s |
| Peak observed total GPU memory                                        |                       5,671 MiB |                       7,543 MiB |
| Ollama model/context allocation, all reported in VRAM                 | 3,877,571,133 bytes (3,698 MiB) | 6,194,766,806 bytes (5,908 MiB) |
| Peak observed WSL system RAM used                                     |                       4,953 MiB |                       5,245 MiB |

Medians are across eight workflows per model, including one cold workflow;
P6/P7 medians are calculated independently, so need not sum to workflow median.
Latency includes service validation and two-pass model execution, not HTTP UI,
PDF extraction or database time. Models used fixed case order and prompt caching;
this is a small operational sample, not a statistically controlled speed study.

## Accuracy and P7 observations

- **4B** omitted MCP in both raw architecture outputs. Existing deterministic
  recovery restored it. **8B** selected the correct MCP component quote in both.
  Both selected the same three supported AND components; neither invented cloud
  architecture or data-flow evidence.
- **4B** selected the professional SQL work passage. **8B** selected only the
  skills heading in that case, and selected keyword-list quotes for all database
  alternatives in the keyword case. These are source-exact but insufficient for
  proficiency; unchanged P6 policy recovered professional work as Partial and
  rejected keyword-only qualification credit. Larger size did not remove the
  need for these safeguards.
- **4B** selected both eligible P7 cards in every run (16 cards total). **8B**
  selected only parent p1 in every run (8 cards total), omitting the Rust Unknown
  clarification even when it was ordered first. This is allowed by the zero-to-five
  selection contract, but gives narrower coverage. No consistent selection-quality
  improvement was observed from 8B.
- All displayed cards were `clarify`, with `wording: null`, for both models.
  SQL work never became affirmative proficiency wording. Unknown cards explicitly
  say lack of CV evidence does not mean lack of qualification. P7 factual safety
  here principally comes from server-owned content and selection-only output.
  This sample does not evaluate generated CV prose or the `surface_evidence` path.

GPU sampling used `nvidia-smi` approximately once per second, plus workflow-end
samples; peaks include display/other GPU allocations (baseline about 1,851 MiB).
Ollama `/api/ps` reported `size_vram == size`, context 8,192, runner `llamacpp`
for both models: no CPU weight offload indicated. Layer-level offload and isolated
host-process peak RSS were unavailable. WSL RAM is whole-system MemTotal minus
MemAvailable, not model RSS. Sampled peaks can miss brief spikes. 8B left only
about 645 MiB of total GPU headroom at the observed peak.

## Recommendation and verification

Keep **4B Q4_K_M** for current P6/P7: identical final classifications and factual
safety in this sample, faster matching and more VRAM headroom. Retain the SQL
proficiency and AND/OR evidence gates regardless of model choice.

For P8, start development with 4B as the baseline, but choose a prose-generation
model only after a separate bounded benchmark of tailored wording, attribution,
qualifiers, unsupported achievements and longer-context behavior. P7 card
selection cannot establish either model's suitability for rewriting a CV. This
benchmark provides no evidence warranting an 8B default switch before P8.

Actual commands/results:

- PASS: `pnpm --filter @ai-job-hunter/api test:compile`.
- PASS: `node /tmp/ai-job-hunter-qwen-benchmark/run.mjs` (the retained probe with
  the original absolute root/output setup): 16/16 workflows and status vectors.
- PASS: `node /tmp/ai-job-hunter-qwen-benchmark/analyze.mjs`: recomputed medians,
  checked raw CV quote source membership and displayed suggestion spans; zero
  source-membership/span failures. This was an offline inspection, no extra calls.

- PASS: `node --input-type=module` (inline assertions against retained JSON):
  16 workflows, 64 calls, expected AND/OR component statuses/credits,
  source-exact raw/final CV quotes, null wording and valid suggestion evidence spans.
- PASS: `node --check docs/audits/qwen-model-benchmark.probe.mjs`.
- PASS: `pnpm exec prettier --check docs/audits/qwen-model-benchmark.md docs/audits/qwen-model-benchmark.probe.mjs docs/audits/fixtures/qwen-model-benchmark-results.json`.
- PASS: `git diff --check` for tracked changes; all three additions also passed
  scoped Prettier validation. Final `/api/ps` returned no resident models.

Changed files are this report, the standalone probe and synthetic result JSON.
Existing untracked `artifacts/` was preserved. Production configuration, P6/P7
logic and database records are unchanged. No full CI, browser tests, commit, push
or PR were needed or performed. Stop for review before any configuration change.
