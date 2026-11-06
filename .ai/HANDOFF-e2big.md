# E2BIG repair handoff

## Assumptions and changes

One-shot auditor/advisor, reviewer, and worker prompts use UTF-8 stdin followed by EOF; argv contains only options and short identifiers. RPC drivers remain JSONL over stdin. No Goal/Handoff truncation, context budget changes, new configuration, or persistent-state schema changes.

Changed runtime files: `src/shared/spawn-runner.ts`, `src/shared/pi-process.ts`, `src/shared/review-process.ts`, `src/flow/parallel/spawner.ts`. The shared runner returns its existing error outcome and kills the process tree on input errors before timeout; once timeout starts, that flow owns the result and the existing SIGTERM grace period, so a derived EPIPE cannot interrupt cleanup; the worker reports a process error and releases its control connection. Listeners are installed before sending data. Existing no-input callers receive EOF.

Changed tests: new `tests/large-prompt-smoke.mjs` wired into `package.json`; stdin-aware fixtures in `tests/openai-fast-smoke.mjs`, `tests/flow-smoke.mjs`, `tests/review-smoke.mjs`, and `tests/goal-review-smoke.mjs`. Existing content, event, model/tool, timeout/cancellation, and control-connection assertions remain. The test-only diagnostic routers spool/replay stdin rather than reintroducing a large argv.

Updated `docs/runtime-contracts.md`. `AGENTS.md` already points to the shared subprocess layer and runtime contract; no additional index change is needed.

## Review follow-up 1: timeout versus pending stdin

Confirmed a P1 in the initial candidate: a non-consuming child timed out while a large input write was pending; stdin EPIPE replaced the timeout result and triggered premature SIGKILL. The same child without input returned timeout and completed its 300ms cleanup.

Both branches now keep shutdown ownership with an already-started timeout. The production timeout, 1000ms SIGTERM grace, and pre-timeout EPIPE reporting are unchanged. The worker's existing killed/exited guards already protect cancellation; no other stdin-error instance needs this timeout guard.

New real-process regressions cover non-consuming stdin and SIGTERM -> close stdin -> 300ms cleanup, each with zero bytes and the same 276034-byte input. Before: large cases returned error/EPIPE, cleanup absent (`quality1-timeout-red.log`, exit 1). After: all four return timeout, both cleanup cases finish; existing input-error and cancellation assertions still pass (`quality1-timeout-green-main.log`, `quality1-timeout-green-live.log`, exit 0).

The fixed main/live commits and final gate logs below supersede the initial candidates; do not deploy an earlier candidate.

## Root cause and red/green evidence

The acceptance recovery path calls `auditor.ts` -> `runPiPrompt` -> `piPromptArgs` -> `runSpawnProcess`; the entire generated check prompt was one argv item. Reviewer and worker startup had the same defect. The reproduction uses a 276034-byte UTF-8 prompt with Chinese text, newlines, and a final Handoff marker. The inherited environment was small; the oversized argv was decisive.

- `red-main.log`: successful build, then three real OS `spawn E2BIG` failures, exit 1 (not a mocked exception).
- `green-target-main.log`: same three entry points pass; short 44-byte prompts also pass; maximum argument length is 46 bytes.
- Received SHA-256: `556219a75a089348ac193104e32ae10691d664d3a001f899d9b858404c6df818` for all three large-prompt receivers. Byte length and Handoff tail match; argv/env contain no prompt.
- Echo/EOF, early exit, ENOENT, timeout, AbortSignal, and EPIPE scenarios pass. Existing Flow smoke covers worker normal exit and cancellation.

The installed host CLI reads stdin until EOF and normalizes outer whitespace. This repair preserves every byte on the transport pipe and never changes Goal files; it does not override the host's own message parsing.

## Verification commands and results

All builds, lint, typechecks, and tests ran on the remote Linux test host, not the editing machine. Repository snapshots were synchronized with the prescribed rsync exclusions. Main tested commit: `077cb84e69cf06f665fcab407157b56c4d5809f3` (baseline `123643e`; runtime repair introduced by `2f3ff0b7e30b40d8dca529a8552247f750f36eae`).

- `npm run build && node tests/large-prompt-smoke.mjs && node tests/openai-fast-smoke.mjs`: exit 0.
- Main `npm run check && npm test`: exit 0; final log `quality1-full-main-final.log`. Includes goal-review, review, flow, package, and all other package smoke suites.
- Live-baseline `npm run check && npm test`: exit 0; final log `quality1-full-live-final.log`. Also includes the live-only external-plan, report-language, and usage-ledger suites.
- Both final complete runs used Node 26 on the remote host with an isolated loopback network namespace. No tests ran on the editing machine.
- `git diff --check`: exit 0.

Validation environment: the host network namespace silently timed out connections to localhost:49327. Unmodified main reproduced the identical review-report failure (`baseline-review.log`). The same baseline passed in a fresh user/network namespace (`baseline-review-netns.log`). Therefore full validation ran unchanged tests in an isolated loopback namespace:

```sh
unshare -Urn bash -c 'ip link set lo up; npm run check && npm test'
```

No production port, system firewall, assertion, timeout, or skip was weakened. The existing optional Bun/footer skips remain environment-dependent. Network isolation has no outbound access; these smoke tests are self-contained.

The reply-producing mock endpoints now drain stdin before replying; forwarding proxies preserve stdin for their target. Report fixtures wait for expected HTML content using the existing wait budget, rather than treating file existence or checkpoint completion as finished asynchronous output. Original content assertions remain.

Intermediate runs also exposed existing graph child-exit and report-registration timing failures. Those files/runtime paths were not changed to chase green, and the failed logs are retained. Alternate LTS/PID-isolated/single-core diagnostics were not uniformly successful. The final unmodified complete commands passed on both branches; this repair does not claim to fix unrelated timing defects.

## Runner audit

No changes to the companion scripts are needed. `pi-flow-run` lines 795-806 launches `pi --mode rpc` with short argv and writes the message as a JSONL prompt to stdin. `flow-auto` lines 590-600 passes a task path or short resume flags, not Goal contents. Python script tests were not run and are not claimed. No second repository PR is needed.

## Live-baseline handoff

The active installation (`bc6ca69`) contains features not yet on fork main. Replacing it with a main-only build would remove existing capabilities. A separate `fix/e2big-live` branch ports this repair onto that active baseline and preserves its existing usage/env, extension loading, and public call signatures. Its tested installation commit is `dee99a4b3c4f75d117a0ae3c15bde22852e817d5`. The port additionally adapts the live-only usage stub and reuses main's existing asynchronous English-report test wait. Production changes are the same four subprocess changes as the main PR; the unrelated live features are not included in that PR.

Build artifacts are retained separately under `$HOME/work/e2big-artifacts/main-077cb84/dist` and `$HOME/work/e2big-artifacts/live-dee99a4/dist` on the build host. The latter is the next goal's installation candidate. Neither is a shared installation.

## Deployment and delivery boundary

No shared installation, task runtime, credentials, or business worktree has been changed in this goal. No package publication or merge. The following goal must install the tested live-baseline commit and demonstrate that the original acceptance recovery gets past the failed spawn; no claim of task recovery is made here.

PR: https://github.com/leonjean214/pi-flow/pull/7 (base `main`, head `fix/e2big`, leave open and unmerged). Both `fix/e2big` (minimal main PR) and `fix/e2big-live` (fixed live-baseline installation commit) are pushed to the owner fork. Do not install the main-only candidate over the feature-bearing live baseline.

Raw logs and deployment identity are kept in the private task handoff; this public handoff contains no original task text or machine identifiers.
