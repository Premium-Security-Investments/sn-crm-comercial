# Hermes interim tender analysis — deployment-readiness runbook

## Status and hard-off gate

This repository does **not** create a Hermes profile, write secrets, restart a gateway, enable variables, or call an AI service. `HERMES-INTERIM` remains unavailable until every one of these deployment values is present and the selector is explicit:

```text
TENDER_ANALYSIS_ENGINE=hermes_interim
HERMES_INTERIM_BASE_URL=http://127.0.0.1:<dedicated-port>
HERMES_INTERIM_API_KEY=[secret]
HERMES_INTERIM_PROVIDER=[approved]
HERMES_INTERIM_MODEL=[approved]
HERMES_INTERIM_POLICY_VERSION=[approved]
HERMES_INTERIM_MAX_COST_USD=[approved]
```

Use a separately approved deployment procedure to set these values server-side. Never expose the bearer key in browser code, logs, prompts, CLI arguments, fixtures, source control, or error responses.

## Dedicated isolated API Server

Before any activation, the platform owner must provision the dedicated Hermes profile named `psi-licitaciones-interim` and configure its API Server with:

1. Bearer authentication; SIIO supplies the key only in the `Authorization` request header.
2. A loopback binding or an approved private endpoint. No public browser CORS access.
3. Stateless OpenAI-compatible `POST /v1/chat/completions` calls: no conversation/session identifiers and a fresh analysis context for every request.
4. All operational toolsets disabled: terminal, filesystem, web/network tools, memory, messaging, delegation, and all write-capable tools.
5. The approved provider, model, policy version, treatment/region gate, per-run and daily budget, timeout, and idempotency policy.

Do not send productive tender content until separate vendor, data-treatment, budget, and security approvals are recorded.

## Authenticated readiness verification

Using an approved server-side bearer credential (never a browser), verify the dedicated API Server before enabling SIIO:

```text
GET /v1/toolsets
GET /v1/capabilities
GET /health/detailed
```

Each request must be authenticated. Confirm that the health endpoint is healthy, the profile is the dedicated one, and every operational toolset/capability is absent or disabled. Preserve only sanitized audit evidence; do not capture authorization headers, raw tender documents, or provider error bodies.

## SIIO release criteria

- `TENDER_ANALYSIS_ENGINE` is explicitly `hermes_interim`; any missing/unknown selector fails closed.
- Base URL is loopback, explicitly allowlisted private, or explicitly allowlisted HTTPS.
- The integration sends only canonical snapshot JSON in the HTTP body, uses `stream:false`, and has no session persistence.
- Output is a single strict JSON object, carries producer `HERMES-INTERIM`, requires human review, validates server-side, and is persisted only after validation.
- The policy treats documents as untrusted data and prohibits GO/NO GO decisions, writes, sends, tool use, and unsupported claims.
- Pre-call per-run and daily budget gates, timeout/abort, safe retry under one idempotency key, and sanitized errors are verified with injected transport tests.

Activation, profile creation, secret storage, gateway restart, network smoke tests, and real model analysis are deliberately outside this task.
