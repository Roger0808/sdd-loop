# Changelog

## Unreleased

### Added

- Added the independent `/sdd-hotfix` workflow and pi aliases `/sdd-hotfix` and `/sdd hotfix`.
- Added `hotfix@1`, per-Hotfix append-only audit shards, H1–H5 checks, per-stream/day numbering, fingerprinted AI Review, human sign-off and archive closure.

### Compatibility

- Hotfix does not mutate or advance the ordinary Loop state.
- Repositories without Hotfix files retain the existing `check` text, JSON/details shape and exit behavior.
- Installing the newly packaged Skill remains an explicit host operation; repository changes never modify local Codex configuration.
