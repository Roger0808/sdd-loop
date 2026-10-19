# Changelog

## Unreleased

### Added

- Added demand units under `docs/loops/demands/<demandId>/`, current-branch auto-selection, explicit `check --demand`, demand-aware governance events and `solo@1` capability discovery.
- Added the `sdd-solo` Skill and pi aliases `/sdd-solo` and `/sdd solo` for one developer to deliver one requirement across multiple Git repositories from a single primary-repository conversation.
- Added one-time `sdd-solo` demand naming: a host-aware conversation title, one canonical feature branch across participants, and explicit per-repository branch exceptions that preserve existing demand work.
- Added complexity-based `sdd-solo` delivery modes: the existing full SDD path and an `openspec-light` path that proceeds from one combined requirements/mode confirmation through OpenSpec generation, implementation and verification, then waits for user acceptance before archive. Multi-repository scope and backward-compatible contract adjustments remain eligible for light delivery; full is reserved for substantive architecture, migration, cutover, sensitive-domain or high-impact governance risk.
- Added `sdd-loop solo check` as the fail-closed Solo evidence gate. It verifies participant trace packages from their recorded commits, writes a primary-repository closure receipt, and invalidates full closure when the manifest or anchored primary evidence drifts.
- Added one concise, checkbox-based `release-checklist.md` for both Solo delivery modes. It centralizes release repositories and order, SQL, project configuration, FilerUI configuration, post-release verification and rollback; Solo closure now rejects incomplete, unresolved or drifted checklists while allowing later checkbox-only execution updates.
- Added the independent `/sdd-hotfix` workflow and pi aliases `/sdd-hotfix` and `/sdd hotfix`.
- Added `hotfix@1`, per-Hotfix append-only audit shards, H1–H5 checks, per-stream/day numbering, fingerprinted AI Review, human sign-off and archive closure.

### Compatibility

- Legacy root `activeLoop` repositories retain their existing `check` behavior and output; demand units are opt-in through migration, and `stream` keeps its same-repository subsystem meaning.
- `sdd-solo` does not create independent Loops in participant repositories. `full` exports and verifies read-only trace packages after per-repository review but before aggregate review and final approval; `openspec-light` exports and verifies a minimal OpenSpec/implementation/verification trace before the result report.
- Hotfix does not mutate or advance the ordinary Loop state.
- Repositories without Hotfix files retain the existing `check` text, JSON/details shape and exit behavior.
- Installing the newly packaged Skill remains an explicit host operation; repository changes never modify local Codex configuration.
