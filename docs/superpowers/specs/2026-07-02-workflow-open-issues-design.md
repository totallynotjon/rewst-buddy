# Workflow Open Issues Design

## Goal

Address all currently open workflow-tooling issues (#122, #123, #124, #125) in one cohesive draft PR.

## Scope

The PR improves Rewst workflow authoring and debugging through better task-field support, clearer workflow inspection, safer errors, and stronger agent steering. It does not hard-block large workflows; it heavily steers agents toward sub-workflow composition while keeping explicit large-canvas edits possible.

## Design

`buddy_workflow_edit` remains the safe high-level mutation path. It will support the advanced fields agents need for real workflow authoring: `runAsOrgId`, `packOverrides`, `isMocked`, `mockInput`, and explicit `with: { items, concurrency }` loop settings. Unsupported or misspelled task fields will be called out instead of silently ignored.

`buddy_workflow_get` and simple task-list tools will keep normal output concise, but surface non-default advanced fields when they affect behavior, especially mocked tasks, run-as-org overrides, retry settings, task mode/join, and loop configuration. This keeps agent graph views truthful without flooding ordinary reads.

Runtime and creation tools will fail more helpfully. `buddy_create_workflow` validates the 255-character description limit locally. `buddy_workflow_run` already includes the execution id on wait timeout; tests will pin that behavior. `buddy_workflow_search` keeps its cross-org index model and adds clearer indexed-org reporting so a zero-match result is interpretable.

Tool descriptions will strongly steer workflow composition: reusable chunks, workflows around 15-20 tasks, or distinct concerns should become sub-workflows with `set_inputs` and `set_output`. This is guidance, not enforcement.

`buddy_render_jinja` will document runtime gotchas discovered in #125: stored dict key order may differ from authoring order, Jinja backreferences require doubled escaping, and rendered control characters should produce a warning.

## Testing

Use TDD for behavior changes. Primary coverage lives in:

- `src/ui/chat/tools/workflowTools.test.ts`
- `src/capabilities/rewstReadCapabilities.test.ts`
- `src/capabilities/workflowCrudCapabilities.test.ts`
- `src/capabilities/registry.test.ts`
- `src/packageManifest.test.ts`

Targeted verification:

- `npm run test:grep -- "Unit: workflowTools"`
- `npm run test:grep -- "Unit: rewstReadCapabilities"`
- `npm run test:grep -- "Unit: workflowCrudCapabilities"`
- `npm run test:grep -- "Unit: package manifest"`
- `npm run changelog:check`
