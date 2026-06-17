#!/usr/bin/env node
/**
 * Empirically learn the workflow WRITE path: read a workflow, convert the typed
 * read shape into WorkflowInput, send it back via updateWorkflow, re-read, and
 * diff to discover what is lost / transformed on round-trip.
 *
 *   node scripts/wf-roundtrip.mjs <orgId> <workflowId> [--apply] [--mutate-label]
 *
 * Without --apply: dry run, prints the WorkflowInput it WOULD send. No mutation.
 * With --apply: performs updateWorkflow(createPatch:true, overwrite:true), then
 *   re-reads and diffs. createPatch gives an undo point in workflow history.
 * With --mutate-label: also tweaks one transition label to validate a real edit.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
	for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
	}
} catch {
	/* no .env */
}

const HTTP_URL = process.env.REWST_GRAPHQL_URL ?? 'https://api.rewst.io/graphql';
const token = process.env.REWST_TEST_TOKEN;
const cookie = token.includes('=') ? token : `appSession=${token}`;

async function gql(query, variables = {}) {
	const res = await fetch(HTTP_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie },
		body: JSON.stringify({ query, variables }),
	});
	return res.json();
}

const GET = `query ($where: WorkflowWhereInput) {
  workflow(where: $where) {
    id name description type schemaVersion version orgId
    updatedAt latestPatchCreatedAt
    input inputSchema outputSchema varsSchema metadata timeout
    tasks {
      id name actionId description input metadata
      transitionMode publishResultAs join timeout humanSecondsSaved
      isMocked mockInput runAsOrgId securitySchema
      retry { count delay when }
      with { items concurrency }
      next { id from to when label do publish top left orientation targetHandles }
    }
  }
}`;

const UPDATE = `mutation ($workflow: WorkflowInput!, $createPatch: Boolean, $openedAt: String, $comment: String) {
  updateWorkflow(workflow: $workflow, createPatch: $createPatch, openedAt: $openedAt, comment: $comment) {
    id name updatedAt
  }
}`;

function transitionToInput(t) {
	return {
		id: t.id ?? undefined,
		from: t.from ?? undefined,
		to: t.to ?? undefined,
		when: t.when ?? undefined,
		label: t.label ?? undefined,
		do: t.do ?? [],
		publish: t.publish ?? [],
		top: t.top ?? undefined,
		left: t.left ?? undefined,
		orientation: t.orientation ?? undefined,
		targetHandles: t.targetHandles ?? undefined,
	};
}

function taskToInput(t) {
	return {
		id: t.id,
		name: t.name,
		actionId: t.actionId ?? undefined,
		description: t.description ?? undefined,
		input: t.input ?? {},
		metadata: t.metadata ?? {},
		transitionMode: t.transitionMode ?? undefined,
		publishResultAs: t.publishResultAs ?? undefined,
		join: t.join ?? undefined,
		timeout: t.timeout ?? undefined,
		humanSecondsSaved: t.humanSecondsSaved ?? undefined,
		isMocked: t.isMocked ?? undefined,
		mockInput: t.mockInput ?? undefined,
		runAsOrgId: t.runAsOrgId ?? undefined,
		securitySchema: t.securitySchema ?? undefined,
		retry: t.retry ?? undefined,
		with: t.with ?? undefined,
		next: (t.next ?? []).map(transitionToInput),
	};
}

function workflowToInput(w) {
	return {
		id: w.id,
		orgId: w.orgId,
		name: w.name,
		description: w.description ?? undefined,
		type: w.type ?? undefined,
		schemaVersion: w.schemaVersion ?? undefined,
		version: w.version ?? undefined,
		input: w.input ?? undefined,
		inputSchema: w.inputSchema ?? undefined,
		outputSchema: w.outputSchema ?? undefined,
		varsSchema: w.varsSchema ?? undefined,
		metadata: w.metadata ?? undefined,
		timeout: w.timeout ?? undefined,
		tasks: (w.tasks ?? []).map(taskToInput),
	};
}

/** Stable signature of a task's meaningful content for diffing (ignores ordering). */
function taskSig(t) {
	return JSON.stringify({
		id: t.id,
		name: t.name,
		actionId: t.actionId,
		input: t.input,
		publishResultAs: t.publishResultAs,
		transitionMode: t.transitionMode,
		next: (t.next ?? []).map(n => ({ when: n.when, label: n.label, do: n.do, publish: n.publish })),
	});
}

function diff(before, after) {
	const b = new Map((before.tasks ?? []).map(t => [t.id, t]));
	const a = new Map((after.tasks ?? []).map(t => [t.id, t]));
	const problems = [];
	if (b.size !== a.size) problems.push(`task COUNT changed: ${b.size} -> ${a.size}`);
	for (const [id, bt] of b) {
		const at = a.get(id);
		if (!at) {
			problems.push(`task LOST: ${id} (${bt.name})`);
			continue;
		}
		if (taskSig(bt) !== taskSig(at)) {
			problems.push(`task CHANGED: ${id} (${bt.name})\n   before: ${taskSig(bt)}\n   after:  ${taskSig(at)}`);
		}
	}
	for (const id of a.keys()) if (!b.has(id)) problems.push(`task ADDED unexpectedly: ${id}`);
	return problems;
}

const [orgId, workflowId, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');
const mutateLabel = flags.includes('--mutate-label');

const before = (await gql(GET, { where: { id: workflowId, orgId } })).data?.workflow;
if (!before) {
	console.error('workflow not found');
	process.exit(1);
}
console.log(`workflow: ${before.name} (${before.tasks.length} tasks)`);
console.log(`updatedAt=${before.updatedAt} latestPatchCreatedAt=${before.latestPatchCreatedAt}`);

const input = workflowToInput(before);

if (mutateLabel) {
	const t = input.tasks.find(x => (x.next ?? []).length > 0);
	if (t) {
		const original = t.next[0].label;
		t.next[0].label = (original || '') + ' [probe]';
		console.log(`\nmutating: task ${t.name} transition label "${original}" -> "${t.next[0].label}"`);
	}
}

if (flags.includes('--probe-add')) {
	const newId = (await import('node:crypto')).randomUUID().replace(/-/g, '');
	input.tasks.push({
		id: newId,
		name: 'probe_temp_node',
		actionId: 'cf6cc66e-a149-4f06-82f5-59f4d72ba93e', // core.noop
		input: {},
		metadata: {},
		transitionMode: 'FOLLOW_ALL',
		next: [],
	});
	// connect: add a transition from "success" to the new node (duplicate-safe; success already -> noop_end)
	const fromTask = input.tasks.find(t => t.name === 'success');
	fromTask.next.push({ when: '{{ SUCCEEDED }}', label: 'probe_edge', do: [newId], publish: [] });
	console.log(`\nadding orphan-ish task ${newId} (probe_temp_node) + edge success->it`);
}

if (flags.includes('--probe-remove')) {
	const before2 = input.tasks.length;
	input.tasks = input.tasks.filter(t => t.name !== 'probe_temp_node');
	for (const t of input.tasks) t.next = (t.next ?? []).filter(n => n.label !== 'probe_edge');
	console.log(`\nremoving probe_temp_node + probe_edge (${before2} -> ${input.tasks.length} tasks)`);
}

if (flags.includes('--clear-probe')) {
	let cleared = 0;
	for (const t of input.tasks)
		for (const n of t.next ?? [])
			if (typeof n.label === 'string' && n.label.includes(' [probe]')) {
				n.label = n.label.replace(/ \[probe\]/g, '');
				cleared++;
			}
	console.log(`\nclearing ${cleared} probe label(s)`);
}

if (!apply) {
	console.log('\n=== DRY RUN: WorkflowInput that would be sent ===');
	console.log(JSON.stringify(input, null, 2));
	console.log('\n(re-run with --apply to perform the round-trip)');
	process.exit(0);
}

const openedAt = process.env.OPENED_AT ?? before.updatedAt;
console.log(`\napplying updateWorkflow(createPatch:true, openedAt:${openedAt})...`);
const res = await gql(UPDATE, {
	workflow: input,
	createPatch: true,
	openedAt,
	comment: 'rewst-buddy round-trip probe',
});
if (res.errors) {
	console.log('\n=== updateWorkflow ERRORS ===');
	console.log(JSON.stringify(res.errors, null, 2));
	process.exit(1);
}
console.log('updateWorkflow ok:', JSON.stringify(res.data?.updateWorkflow));

const after = (await gql(GET, { where: { id: workflowId, orgId } })).data?.workflow;
const problems = diff(before, after);
console.log('\n=== ROUND-TRIP DIFF ===');
if (problems.length === 0) console.log('No content differences detected — round-trip is faithful.');
else console.log(problems.join('\n'));
console.log(
	`\nafter: updatedAt=${after.updatedAt} latestPatchCreatedAt=${after.latestPatchCreatedAt} tasks=${after.tasks.length}`,
);
