# Agent Guide — ep_cursortrace

Show cursor/caret movements of other users in real time.

## Tech stack

* Etherpad plugin framework (hooks declared in `ep.json`)

## Project structure

```
ep_cursortrace/
├── AGENTS.md
├── CONTRIBUTING.md
├── coalescer.js
├── docs/
├── ep.json
├── handleMessage.js
├── package.json
├── static/
│   ├── css/
│   ├── js/
│   ├── tests/
```

## Helpers used

_None — `ep_plugin_helpers` is not a dependency. Adoption is part of the helpers-adoption sweep (Phase 4)._


## Helpers NOT used

_To be audited in the helpers-adoption sweep (Phase 4)._


## Running tests locally

`ep_cursortrace` runs inside Etherpad's test harness. From an etherpad checkout that has installed this plugin via `pnpm run plugins i --path ../ep_cursortrace`:

```bash
# Backend (Mocha) — harness boots its own server
pnpm --filter ep_etherpad-lite run test

# Playwright — needs `pnpm run dev` in a second terminal
pnpm --filter ep_etherpad-lite run test-ui
```

## Standing rules for agent edits

* PRs target `main`. Linear commits, no merge commits.
* Every bug fix includes a regression test in the same commit.
* All user-facing strings in `locales/`. No hardcoded English in templates.
* No hardcoded `aria-label` on icon-only controls — etherpad's html10n auto-populates `aria-label` from the localized string when (a) the element has a `data-l10n-id` and (b) no author-supplied `aria-label` is present. Adding a hardcoded English `aria-label` blocks that and leaves it untranslated. (See `etherpad-lite/src/static/js/vendors/html10n.ts:665-678`.)
* No nested interactive elements (no `<button>` inside `<a>`).
* LLM/Agent contributions are explicitly welcomed by maintainers.

## Quick reference: hooks declared in `ep.json`

* Server: `handleMessage`
* Client: `aceEditorCSS`, `aceInitInnerdocbodyHead`, `postAceInit`, `aceEditEvent`, `handleClientMessage_CUSTOM`

When adding a hook, register it in both `ep.json` *and* the matching `exports.<hook> = ...` in the JS file.
