# Testing guide

Tests use mocked HTTP and browser fixtures. They must never login to or mutate a
real LinkedIn or Naukri account.

```shell
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run pack:dry-run
npm run pack:verify
```

Current coverage includes:

- public HTML/JSON-LD normalization and untrusted URL rejection;
- input/result caps and configuration requirements;
- retry, timeout, rate-limit, and anti-bot behavior;
- encrypted session round-trip, tamper rejection, redaction, and concurrent
  writes;
- manual login completion, auth expiry, challenge handling, and logout;
- profile reads, validated updates, selector failures, partial writes, resume
  confinement/signature/size checks;
- disabled mutations, exact confirmation, expiry, replay prevention, drift,
  idempotent no-op, and per-provider serialization;
- package metadata and placeholder-only sample configuration.

When changing provider selectors, add or update fixture tests for both success
and failure. Live smoke tests, if approved separately, must start read-only and
must not execute a mutation as part of CI.

## Package-content verification

`npm run pack:dry-run` must include only the allowlisted `files` entries plus
npm-required metadata. It must not include:

- `.env` or key/session files;
- resumes;
- `node_modules`;
- source maps or build caches unless intentionally released;
- tests, coverage, fixtures, or temporary files;
- repository or user MCP configuration.
