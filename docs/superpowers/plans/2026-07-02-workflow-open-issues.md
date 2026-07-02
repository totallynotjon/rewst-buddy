# Workflow Open Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one draft PR that addresses open issues #122, #123, #124, and #125.

**Architecture:** Keep workflow authoring through the existing high-level tool boundaries. Expand the operation allowlist and graph output only where fields materially affect execution, and keep tool descriptions as the main heavy-steering surface for sub-workflow composition.

**Tech Stack:** TypeScript, VS Code extension APIs, Rewst GraphQL, Mocha/assert tests, MCP capability registry.

---

### Task 1: Workflow Edit And Graph Truthfulness

**Files:**
- Modify: `src/ui/chat/tools/workflowTools.ts`
- Modify: `src/ui/chat/tools/workflowTools.test.ts`

- [ ] Add failing tests for setting `runAsOrgId`, `packOverrides`, `isMocked`, and `mockInput` through `add_task` and `update_task`.
- [ ] Add failing tests that `buddy_workflow_get` shows non-default advanced task fields and mocked tasks, while omitting normal defaults.
- [ ] Add failing tests for `with.concurrency` documentation and `CTX.item` loop lint/warning.
- [ ] Implement minimal field setters, validation, output formatting, and docs text.
- [ ] Run `npm run test:grep -- "Unit: workflowTools"`.

### Task 2: Simple Task List Mock Visibility

**Files:**
- Modify: `src/capabilities/rewstReadCapabilities.ts`
- Modify: `src/capabilities/rewstReadCapabilities.test.ts`

- [ ] Add failing test showing mocked tasks get a visible marker.
- [ ] Add failing test showing non-mocked tasks stay quiet.
- [ ] Implement conditional mocked formatting.
- [ ] Run `npm run test:grep -- "Unit: rewstReadCapabilities"`.

### Task 3: Create Workflow Description Validation

**Files:**
- Modify: `src/capabilities/workflowCrudCapabilities.ts`
- Modify: `src/capabilities/workflowCrudCapabilities.test.ts`

- [ ] Add failing test for local rejection of descriptions longer than 255 characters.
- [ ] Confirm no approval or GraphQL call occurs on invalid descriptions.
- [ ] Add schema/description wording for the limit.
- [ ] Run `npm run test:grep -- "Unit: workflowCrudCapabilities"`.

### Task 4: Search, Run, Render, And Steering Polish

**Files:**
- Modify: `src/ui/chat/tools/workflowTools.ts`
- Modify: `src/ui/chat/tools/workflowTools.test.ts`

- [ ] Add tests pinning wait-timeout output includes `executionId` and status.
- [ ] Add search-output test for indexed org summaries.
- [ ] Add render warning test for control characters.
- [ ] Update composition steering, Jinja key-order, and backslash docs.
- [ ] Run `npm run test:grep -- "Unit: workflowTools"`.

### Task 5: Changelog And PR

**Files:**
- Create: `changelog.d/125.md`

- [ ] Add one concise Fixed changelog note covering the combined workflow-tooling PR.
- [ ] Run targeted tests, package manifest check, changelog check, and compile.
- [ ] Create a draft PR with `gh pr create --draft`.
