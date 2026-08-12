# AGT-002 v3 Synthetic UI Preview Design

**Date:** 2026-08-06
**Status:** approved for isolated Vercel Preview

## Goal

Provide Juan with a live, reviewable representation of the AGT-002 v3 governed output before implementing runtime v3 or connecting real tender data.

## Scope

- Hidden route: `#/tenders?preview=agt002-v3`.
- Existing authenticated CRM shell and tender access controls remain in force.
- Synthetic, explicitly labelled tender only.
- Read-only client rendering: no API requests, forms, uploads, decisions, writes, migrations, or production navigation entry.
- Five ordered phases: descarte, habilitantes, técnico, financiero/ejecución, estratégico.
- Per-unit detail shows status, evidence or abstention, the five independent axes, commercial impact, legal assessment, action owner role, and human review pending.
- Human GO/NO-GO remains outside the preview.

## Interaction

The left rail selects a synthetic requirement. The right pane updates its governed detail. The summary header and phase counters remain fixed. Selection is local React state and has no persistence.

## Visual direction

A compact institutional workbench matching the existing Seguridad Nacional CRM: navy command header, white evidence canvas, restrained blue/amber/red/green status semantics, dense but readable requirement rail, responsive single-column fallback.

## Safety

The preview must visibly state `Datos sintéticos`, `Sólo lectura`, and `Validación humana pendiente`. Source citations are invented identifiers belonging only to the synthetic fixture and must not resemble customer documents. There are no model or backend calls.

## Acceptance

1. Hidden preview URL renders inside the current tender shell after login.
2. Every institutional phase is visible in the required order.
3. Selecting a requirement updates its detail.
4. The detail exposes evidence/abstention, all five axes, commercial and legal analysis, and a traceable next action.
5. No actionable decision, form, API/fetch call, or data mutation exists.
6. Build, focused tests, regression tests, and browser QA pass before Vercel Preview deployment.
