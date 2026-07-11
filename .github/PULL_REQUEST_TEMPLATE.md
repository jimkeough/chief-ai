## Summary

<!-- What changed, and why? -->

## Verification

<!-- List the checks and end-to-end flows you ran. -->

## Release checklist

- [ ] I increased the Chief version with `npm run release:patch` (or the
      appropriate `release:minor` / `release:major` command).
- [ ] `npm run release:check` and `npm run typecheck` pass.
- [ ] I reviewed `README.md`, `TRUST.md`, `AGENTS.md`, and `CLAUDE.md`, updating
      only the contracts affected by this change.
- [ ] If I changed the upstream updater workflow, I synchronized its embedded
      copy in `lib/updater-workflow.ts`.
