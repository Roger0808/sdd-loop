<h1 align="center">sdd-loop</h1>

<p align="center">
  <strong>Turn "talking to an AI about requirements" into a process you can repeat and audit</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Node-%E2%89%A520-brightgreen.svg" alt="Node >= 20">
  <img src="https://img.shields.io/badge/hosts-13-8A2BE2" alt="Hosts">
</p>

<p align="center">
  <a href="#installation">Install</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#commands">Commands</a> &bull;
  <a href="#the-7-station-interview">Interview</a>
</p>

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_zh.md">简体中文</a>
</p>

---

One-line request → 7-station interview → isolated-worktree implementation → automated verification → architecture reconciliation → AI review → human review → close this round. One full turn around that circle is a **Loop**.

## What it fixes

| What you hit | What it does |
|---|---|
| Ask an AI to write a requirements doc and it sounds authoritative, but half of it is guessed | Forces a split between "asked and answered", "found in the code", and "still unknown". If it can't be found, it's marked *to be investigated* — **never invented** |
| First version shipped, no idea where round two picks up | The status file records where you stopped. Reconcile before you start; if the claims and the files disagree, stop |
| A doc says "done" and the code has nothing of the sort | Puts the status file's **claims** next to the **facts** on disk and lists every mismatch |
| Every clause comes out in a different shape, and the IDs don't line up | Look up the requirements before writing: which items this kind of clause needs, and which ID families this repo already uses |
| Halfway through the chat the AI forgets what was agreed | Each station's output lands on disk right away — nothing depends on conversation memory |
| One person's Loop is open, so everyone else works outside the gates | Split the repo into one stream per subsystem: each has its own status, gate and archive ([how](#several-teams-in-one-repo)) |
| Code changed but the system architecture is still last quarter's picture | Maintain a long-lived Architecture Baseline under `docs/architecture/`, then reconcile it from final code before review |
| Tests are green, so an AI calls the work done without reviewing the diff | Separate automated verification, read-only AI review and explicit human approval; only the last one closes the Loop |

## Installation

Requires Node ≥ 20. Three commands install into every host on this machine:

```bash
git clone https://github.com/Roger0808/sdd-loop.git && cd sdd-loop
npm link
sdd-loop init -g
```

`init -g` installs four skills: `skills/sdd-init`, `skills/sdd-interview`, `skills/sdd-upgrade`, and `skills/sdd-review`. It skips hosts it cannot detect. Ten open-standard hosts share `~/.agents/skills/`; Hermes reads that same directory through its supported `skills.external_dirs` setting.

| Host | Install path | Init a repo | Run the interview |
|---|---|---|---|
| Claude Code | `~/.claude/skills/` | `/sdd-init` | `/sdd-interview` |
| Codex | `~/.agents/skills/` | say "initialize SDD" | say "run the SDD interview" |
| Gemini CLI | `~/.agents/skills/` | say "initialize SDD" | say "run the SDD interview" |
| GitHub Copilot | `~/.agents/skills/` | say "initialize SDD" | say "run the SDD interview" |
| Cursor ⚠️ | `~/.agents/skills/` | say "initialize SDD" | say "run the SDD interview" |
| Windsurf | `~/.agents/skills/` | say "initialize SDD" | say "run the SDD interview" |
| OpenCode | `~/.agents/skills/` | say "initialize SDD" | say "run the SDD interview" |
| Kimi Code | `~/.agents/skills/` | say "initialize SDD" | say "run the SDD interview" |
| Antigravity | `~/.agents/skills/` | say "initialize SDD" | say "run the SDD interview" |
| Factory Droid | `~/.agents/skills/` | say "initialize SDD" | say "run the SDD interview" |
| Roo Code | `~/.agents/skills/` | say "initialize SDD" | say "run the SDD interview" |
| Hermes Agent | `${HERMES_HOME:-~/.hermes}/config.yaml` registers `~/.agents/skills/` | say "initialize SDD" | say "run the SDD interview" |
| pi | `pi install` registers the package | `/sdd init` | `/sdd` |

⚠️ Cursor has several reports of not following symlinks, and symlinks are exactly how this package installs — it may not be discovered there.

**sdd-upgrade** brings an existing repo up to current gates, converts single-stream layouts, or audits an existing AGENTS.md into a temporary Candidate. Candidate deletion, movement and merging require item-by-item approval; host/model configuration is never rewritten. **sdd-review** owns post-implementation closeout: architecture reconciliation, change surface, independent read-only AI review, and the human-review packet.

`sdd-loop check` and `sdd-loop guide` are typed the same way in every host; pi also ships them as the built-in `sdd_loop_check` / `sdd_spec_guide` tools. In pi, use `/sdd upgrade` for upgrades and AGENTS audits, and `/sdd review` for review closeout; an unknown `/sdd` subcommand prints usage instead of starting an interview.

```bash
sdd-loop init -g --claude   # only ~/.claude/skills/
sdd-loop init -g --agents   # only ~/.agents/skills/ (shared by the other hosts above)
sdd-loop init -g --hermes   # shared links + Hermes external_dirs registration
sdd-loop init -g --pi       # only register with pi
sdd-loop init -g --show     # dry run: say what would happen, touch nothing
```

Re-running is safe: it **never deletes any existing file or directory**. Hermes configuration is parsed as YAML, updated without duplicate paths, backed up before an existing file changes, and atomically replaced. Invalid YAML or an unexpected field type is reported and left untouched. This connects an existing Hermes installation; it does not install Hermes itself or place duplicate links in `~/.hermes/skills/`. Run it separately under each `HERMES_HOME` profile that should see the skills.

**Restart the host** after installing so the new skills get loaded (Gemini also takes `/skills reload`; Hermes loads them in a new session).

<details>
<summary>Upgrading from 0.x</summary>

0.x installed into each host's own directory (`~/.codex/skills/`, `~/.gemini/skills/`); the shared `~/.agents/skills/` replaces them. Hosts **do not deduplicate**: with the same skill in both directories it gets listed twice, and the model sees two skills with one name.

`init -g` finds the stale symlinks and prints the `rm` commands, but **will not delete them for you** — they might be ones you recreated yourself. Removing them is enough; the skill contents did not change.

</details>

## Quick start

| Step | How often | How |
|---|---|---|
| **1. Initialize the repo** | once per repo | trigger sdd-init in the project ([per-host triggers](#installation)) |
| **2. Run one interview** | once per Loop | trigger sdd-interview and walk the [7 stations](#the-7-station-interview) |
| **3. Reconcile before you start** | every round | `sdd-loop check` |
| **4. Implement** | every Loop | split repos use one branch + worktree per stream and Loop |
| **5. Review and close** | every Loop | trigger sdd-review, then obtain explicit human approval |

Step 2 can also be "I already have a PRD, turn it into SDD" — the outline is the same, and anything the PRD doesn't cover still gets asked.

### Lifecycle gates

`Requirements → Architecture + Architecture Baseline → Specification → Tasks → Worktree Ready → Implementation → Automated Verification → Architecture Reconciliation → AI Review → Human Review → Closed`

The six stage documents and their status values remain unchanged; the added names are gates. Loop-local `architecture.md` describes this round's design. The long-lived Architecture Baseline describes the current system: reuse an existing `docs/architecture/` layout, otherwise use `docs/architecture/overview.md` for one system or `docs/architecture/<stream>.md` for split repos. Diagrams stay reviewable as Mermaid or ASCII.

At Implementation start, `implementation.md` records the base branch, base commit, current branch and task scope—never a machine-local worktree path. After tests, the implementer updates the Baseline from final code and writes the code/config/data/API/deployment/test/documentation change surface. A separate read-only reviewer then produces `READY_FOR_HUMAN_REVIEW`, `CHANGES_REQUIRED`, or `NOT_REVIEWABLE_SAFELY`. Any material change invalidates that review. `verification.md` remains draft until a human records approver, time, reviewed version and fingerprint.

In split repos, every stream + Loop uses its own branch and worktree; the main checkout is reserved for synchronization, integration and review. An already-running Loop may record a one-time exemption during sdd-upgrade, but the next Loop must use a worktree.

When sdd-init finds no AGENTS.md, it classifies template applicability and writes the final workflow-organized file directly. When one exists, sdd-init/sdd-upgrade write the Candidate and classification report under `/tmp`, never overwrite it silently, and require per-item approval for deletion, movement or merging. The fixed classifications are `KEEP_SDD_CANONICAL`, `KEEP_PROJECT_SPECIFIC`, `DUPLICATED`, `STALE`, `MODEL_OR_HOST_SPECIFIC`, `BELONGS_IN_AGENT_CONFIG`, `CANONICAL_ELSEWHERE`, and `UNCLEAR`.

An AGENTS audit emits exactly one conclusion: `RECOMMEND_ADOPTION`, `NEEDS_REVISION`, `KEEP_CURRENT`, or `NOT_TESTABLE_SAFELY`.

## Commands

### `sdd-loop check` — state reconciliation

```bash
sdd-loop check                    # current repo
sdd-loop check --repo <dir>       # a specific repo
sdd-loop check --stream <name>    # just one stream (see below)
sdd-loop check --json             # machine-readable
```

Four things: whether the front matter parses at all, whether the directory `activeLoop` points at is empty, whether every stage document of a closed Loop made it into the archive, and which gate you are currently blocked on.

| Exit code | Meaning |
|---|---|
| `0` | clean |
| `1` | claims contradict the facts |
| `2` | the evidence can't be read — no verdict is given at all |

**Read-only.** Contradictions are for people to resolve: it does not edit state, resolve conflicts, archive, or rename files.

A status path that exists but cannot be read — for example, a directory accidentally named `status.md` — is unreadable evidence (exit `2`), not a missing-status cold start.

### `sdd-loop guide` — clause dictionary

```bash
sdd-loop guide                                  # list every type
sdd-loop guide --type specification.entity-table
```

Three things: which items this kind of clause needs, the ID families this repo already uses (new clauses reuse the same prefix), and one reference clause. **It states requirements before you write; it never judges after the fact.**

<details>
<summary>All 17 clause types</summary>

**requirements.md** — `goal` · `non-goal` · `scenario` · `success-criterion` · `non-functional`

**architecture.md** — `module-boundary` · `adr` · `integration` · `schema-change` · `migration-map`

**specification.md** — `entity-table` · `state-machine` · `permission-matrix` · `behavior` · `page-behavior` · `approval-flow`

**tasks.md** — `task`

</details>

## The 7-station interview

Each station's output lands on disk immediately at `status: draft`; promoting it to `confirmed` is a human action the AI never takes for you.

| Station | Questions | Lands in |
|---|---|---|
| **0 · Starting point and company background** | the one-line request, product name, target business domain, success criteria, industry, stage, business model, scale, tools in use today, current pain, goal for this phase, what's out of scope | requirements.md<br>background / goals / non-goals / success criteria |
| **1 · Business context** | how this runs today, who takes part, where it stalls, how far this phase closes the loop, where the boundary is | requirements.md<br>user scenarios / scope |
| **2 · System skeleton** | how modules split, core entities and relations, business documents, shared mechanisms, tech choices, how external systems connect | architecture.md<br>module boundaries / decisions / integrations |
| **3 · Coarse scenario walkthrough** | end-to-end main flow, key scenarios, exception branches, approval flows | specification.md<br>main flow / exception branches / approval flows |
| **4 · Field lists and business rules** | which documents/objects exist, every field (control, values, required, which page), state machines, who can do what in each state, business rules | specification.md<br>entity tables / state machines / permission matrices / behavior clauses |
| **5 · Worked example data** | sample master data, sample documents, event sequences, test cases | specification.md<br>examples (data + events + expectations) |
| **6 · Page specs** | page inventory, key interactions, validation points, list/form/dialog behavior, non-functional requirements | specification.md page behavior<br>requirements.md non-functional requirements |
| **Wrap-up · task breakdown** | no questions — reads the code | tasks.md<br>ID / referenced requirement·architecture·spec IDs / done criteria / how to verify |

## What the files look like

After initialization:

```
your-project/
├── AGENTS.md              # gate rules
├── CLAUDE.md              # points at AGENTS.md
└── docs/
    ├── loops/
    │   ├── status.md      # where you stopped
    │   └── loop-1/        # created at station 0 of the interview
    │       ├── requirements.md
    │       ├── architecture.md
    │       ├── specification.md
    │       └── tasks.md
    └── archive/           # closed Loops move here
```

Those paths are defaults: if your layout differs, point at it with `sdd-loop check --status-file <path>` / `--archive-dir <path>`.

<details>
<summary>Several teams in one repo</summary>

One repo, one status file, one active Loop — that is a lock on the whole repo. While one person's Loop is open, everyone else ships outside the gates.

Split it into one **stream** per independently shipped subsystem. Each stream gets its own status file, its own gate, its own archive:

```
your-project/
└── docs/
    ├── loops/
    │   ├── maker/
    │   │   ├── status.md
    │   │   └── loop-1/
    │   └── admin-console/
    │       ├── status.md
    │       └── loop-2/
    └── archive/
        ├── maker/
        └── admin-console/
```

No config file to add: drop the root status file and `sdd-loop check` discovers the streams and reports each one separately. **A stream that can't be read never withholds the other streams' verdicts.** `--stream <name>` narrows it to one.

With a custom layout, `--status-file` names the path the status file would have in single-stream form; stream discovery inserts `<stream>/` before that filename, while `--archive-dir` gets `<stream>/` appended. For example, `--status-file meta/loops/status.md --archive-dir meta/archive` discovers `meta/loops/maker/status.md` and uses `meta/archive/maker/` for that stream.

Loop numbers are per stream, so `maker/loop-1` and `admin-console/loop-1` are different Loops — write the stream name when you refer to one. Clause IDs (`REQ-001`) are unaffected: they only ever reference each other inside one stream.

Start single-stream and split later if you hit the lock; the migration is a directory move, and sdd-upgrade walks you through it.

**Splitting does not force anyone through the gate.** It removes the excuse, not the possibility — a subsystem with no stream of its own still ships unnoticed. That part is what the AGENTS.md rules are for.

</details>

## License

MIT License — see [LICENSE](LICENSE) for details.
