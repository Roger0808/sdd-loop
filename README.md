<h1 align="center">sdd-loop</h1>

<p align="center">
  <strong>A repeatable, auditable SDD lifecycle for AI-assisted delivery</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Node-%E2%89%A520-brightgreen.svg" alt="Node >= 20">
  <img src="https://img.shields.io/badge/hosts-14-8A2BE2" alt="Hosts">
</p>

<p align="center">
  <a href="#workflow">Workflow</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#commands">Commands</a> &bull;
  <a href="#repository-layout">Layout</a>
</p>

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_zh.md">简体中文</a>
</p>

---

One request → 7-station interview → isolated implementation → verification → architecture reconciliation → AI review → human approval. One complete pass is a **Loop**.

## Workflow

`Requirements → Architecture/Baseline → Specification → Tasks → Worktree Ready → Implementation → Automated Verification → Architecture Reconciliation → AI Review → Human Review → Closed`

The six stage documents and existing `nextPhase` values remain unchanged. The additional nodes are gates:

| Gate | Required evidence |
|---|---|
| Requirements | `requirements.md` is explicitly confirmed |
| Architecture/Baseline | Loop-local `architecture.md` is confirmed and the long-lived Architecture Baseline reflects current system facts |
| Specification | `specification.md` defines verifiable behavior |
| Tasks | `tasks.md` traces each task to confirmed clauses |
| Worktree Ready | In split repos, this stream + Loop has its own branch and Git worktree |
| Implementation | `implementation.md` records base branch, base commit, current branch and task scope |
| Automated Verification | Tests, builds, deployment checks and skipped items are recorded |
| Architecture Reconciliation | Final code is reflected in the Architecture Baseline and change surface |
| AI Review | A read-only reviewer returns one fixed verdict |
| Human Review | A person explicitly approves the reviewed fingerprint |
| Closed | Stage documents are archived and the status file is updated in the same change |

### Worktree isolation

- Split repos use one branch and worktree per `stream + Loop`.
- The main checkout is only for synchronization, integration and review.
- Cross-system/platform changes use their own platform worktree.
- A Loop already implementing in the main checkout may record a one-time exemption; the next Loop cannot inherit it.

### Architecture and review

- Loop-local `architecture.md` describes this round's design. `docs/architecture/` describes the system as it exists now.
- Reuse an existing architecture layout. Otherwise use `docs/architecture/overview.md` for one system or `docs/architecture/<stream>.md` for split repos. Diagrams use Mermaid or ASCII.
- After automated verification, update the Architecture Baseline from final code and list the code, configuration, data, API, deployment, test and documentation change surface.
- Then run an independent, read-only AI review. Its only valid verdicts are `READY_FOR_HUMAN_REVIEW`, `CHANGES_REQUIRED` and `NOT_REVIEWABLE_SAFELY`.
- `verification.md` contains `Automated Verification`, `Architecture Reconciliation & Change Surface`, `AI Code Review` and `Human Review Packet`.
- Any code or critical-document change invalidates the old review. A Loop closes only after a human records approver, time, reviewed version and fingerprint.

## AGENTS.md handling

- Without an existing AGENTS.md, sdd-init selects the applicable single/split-project rules and writes the final structured file directly.
- With an existing AGENTS.md, sdd-init or sdd-upgrade writes `AGENTS.candidate.md` and an itemized report under `/tmp`; it never silently overwrites the repository file.
- Deletion, movement and merging require item-by-item approval. Model, permission, MCP and host configuration are out of scope.

Classifications: `KEEP_SDD_CANONICAL`, `KEEP_PROJECT_SPECIFIC`, `DUPLICATED`, `STALE`, `MODEL_OR_HOST_SPECIFIC`, `BELONGS_IN_AGENT_CONFIG`, `CANONICAL_ELSEWHERE`, `UNCLEAR`.

Audit verdicts: `RECOMMEND_ADOPTION`, `NEEDS_REVISION`, `KEEP_CURRENT`, `NOT_TESTABLE_SAFELY`.

## Installation

Requires Node ≥ 20:

```bash
git clone https://github.com/Roger0808/sdd-loop.git && cd sdd-loop
npm link
sdd-loop init -g
```

Four packaged skills: `skills/sdd-init`, `skills/sdd-interview`, `skills/sdd-upgrade`, `skills/sdd-review`.

| Target | Installation |
|---|---|
| Claude Code | `~/.claude/skills/` |
| Agent Skills hosts | `~/.agents/skills/` — Codex, Gemini CLI, GitHub Copilot, Cursor, Windsurf, OpenCode, OpenClaw, Kimi Code, Antigravity, Factory Droid, Roo Code |
| Hermes Agent | registered through its skills configuration |
| pi | package registration |

Use `--claude`, `--agents`, `--openclaw`, `--hermes` or `--pi` to limit the target. Use `--show` for a zero-write preview. Existing files and directories are never deleted or overwritten.

OpenClaw: `sdd-loop init -g --openclaw` installs to `~/.agents/skills/` with the default state, or to `$OPENCLAW_STATE_DIR/skills/` when a custom state directory is configured.

Restart the host or open a new session after installation.

## Commands

### Status reconciliation

```bash
sdd-loop check
sdd-loop check --repo <dir>
sdd-loop check --stream <name>
sdd-loop check --json
```

| Exit | Meaning |
|---|---|
| `0` | clean |
| `1` | declarations contradict repository facts |
| `2` | evidence is unreadable; no verdict |

### Clause guide

```bash
sdd-loop guide
sdd-loop guide --type specification.entity-table
```

It returns the required fields, existing ID families and a repository example before a clause is written.

pi routes: `/sdd` for interview, `/sdd init`, `/sdd upgrade`, and `/sdd review`. Unknown subcommands return usage.

## Repository layout

```text
your-project/
├── AGENTS.md
├── CLAUDE.md
└── docs/
    ├── architecture/
    │   └── overview.md or <stream>.md
    ├── loops/
    │   └── [<stream>/]
    │       ├── status.md
    │       └── loop-N/
    │           ├── requirements.md
    │           ├── architecture.md
    │           ├── specification.md
    │           ├── tasks.md
    │           ├── implementation.md
    │           └── verification.md
    └── archive/
```

`sdd-loop check` discovers single-stream and split-stream layouts automatically. Custom paths use `--status-file` and `--archive-dir`.

## License

MIT License — see [LICENSE](LICENSE).
