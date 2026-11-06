# Release checklist

No release action is implied by completing this checklist. Publishing requires
separate owner, legal, security, and release approval.

## Version and scope

- [ ] Choose a SemVer version reflecting behavior and schema changes.
- [ ] Update changelog/release notes.
- [ ] Confirm capability matrix matches runtime discovery.
- [ ] Confirm unsupported operations fail explicitly.

## Legal and provider review

- [ ] Confirm Adobe has approved the MIT license for this package.
- [ ] Review `THIRD_PARTY_NOTICES.md` and generate a complete license/SBOM
      report from the lockfile.
- [ ] Review current LinkedIn and Naukri terms, robots directives, and account
      automation policies.
- [ ] Obtain privacy/security approval for encrypted local account sessions and
      resume handling.

## Dependency and artifact review

- [ ] Run an online registry audit and record exact advisory IDs, affected
      paths, runtime/dev classification, and disposition.
- [ ] Resolve or formally accept every advisory.
- [ ] Run `npm ci` from a clean checkout.
- [ ] Install the pinned Chromium revision.
- [ ] Run lint, strict typecheck, all mocked tests, and build.
- [ ] Run `npm pack --dry-run` and inspect every path.
- [ ] Run `npm run pack:verify`.
- [ ] Confirm no key, session, resume, `.env`, `node_modules`, coverage, test
      fixture, or local config is packed.
- [ ] Verify bin scripts on Windows, macOS, and Linux.

## Smoke and rollback

- [ ] Start the packed artifact over stdio and list tools.
- [ ] Validate capability discovery with mutations disabled.
- [ ] Complete approved headed login tests using dedicated non-production test
      accounts.
- [ ] Run read-only search/profile smoke tests.
- [ ] Preview mutations without executing them.
- [ ] Document rollback to the prior package version.
- [ ] Confirm rollback preserves or deliberately invalidates encrypted session
      format compatibility.

## Publication approval

- [ ] Obtain explicit approval to commit.
- [ ] Obtain explicit approval to open and merge a PR.
- [ ] Obtain explicit approval to publish package/image/release artifacts.
- [ ] Publish only from the approved CI/release identity.
