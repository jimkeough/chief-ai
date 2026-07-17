## Summary

<!-- What changed, and why? -->

## Verification

<!-- List the checks and end-to-end flows you ran. -->

## Release checklist

- [ ] `npm run release:check` and `npm run typecheck` pass.
- [ ] If this PR should ship a release to deployed installs, I bumped the Chief
      version with `npm run release:patch` (or `release:minor` / `release:major`).
      Routine PRs stay at the current version.
- [ ] I reviewed `README.md`, `TRUST.md`, `AGENTS.md`, and `CLAUDE.md`, updating
      only the contracts affected by this change.
- [ ] If I changed the upstream updater workflow, I ran
      `npm run release:sync-updater`.
