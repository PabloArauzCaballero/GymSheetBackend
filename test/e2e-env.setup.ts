// E2E suites register many synthetic users in one process; keep the auth
// limiter from masking the behavior under test. An explicit CI override wins.
process.env.AUTH_RATE_LIMIT_MAX ??= "100";
