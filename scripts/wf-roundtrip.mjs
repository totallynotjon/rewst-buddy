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
		metadata: { x: 480, y: 960 },
		transitionMode: 'FOLLOW_ALL',
		next: [],
	});
	// connect from an existing node so the new node isn't an orphan (reversible).
	const fromTask = input.tasks.find(t => t.name === 'can_proceed') ?? input.tasks[0];
	fromTask.next.push({ when: '{{ SUCCEEDED }}', label: 'probe_edge', do: [newId], publish: [] });
	console.log(`\nadding orphan-ish task ${newId} (probe_temp_node) + edge success->it`);
}

if (flags.includes('--probe-remove')) {
	const before2 = input.tasks.length;
	input.tasks = input.tasks.filter(t => t.name !== 'probe_temp_node');
	for (const t of input.tasks) t.next = (t.next ?? []).filter(n => n.label !== 'probe_edge');
	console.log(`\nremoving probe_temp_node + probe_edge (${before2} -> ${input.tasks.length} tasks)`);
}

if (flags.includes('--set-input')) {
	// Mirror of set_inputs: set the input name list, parameters (the action-parameter
	// form that actually drives the UI run/call form), and inputSchema; varsSchema is
	// left untouched (it is the separate trigger/variables map).
	const name = flags[flags.indexOf('--set-input') + 1] ?? 'probe_input';
	input.input = [name];
	input.parameters = {
		[name]: {
			type: 'string',
			label: 'Probe Input',
			default: '',
			required: true,
			multiline: false,
			description: 'set by wf-roundtrip --set-input',
		},
	};
	input.inputSchema = {
		type: 'object',
		required: [name],
		properties: {
			[name]: { type: 'string', title: 'Probe Input', description: 'set by wf-roundtrip --set-input' },
		},
	};
	console.log(
		`\nset input=[${name}] + parameters + inputSchema; varsSchema left as-is (${input.varsSchema ? 'present' : 'absent'})`,
	);
}

if (flags.includes('--autolayout')) {
	// Mirror of src/ui/chat/tools/workflowTools.ts autoLayout (layered + right lane).
	const HEIGHT = 88,
		HGAP = 80,
		VGAP = 80,
		ROW = HEIGHT + VGAP,
		LANE_GAP = 2 * HGAP;
	const MIN_FEEDERS = 2,
		MIN_SPAN = 5;
	const w = t => 209 + 127 * Math.max(1, (t.next ?? []).length);
	const ids = new Set(input.tasks.map(t => t.id));
	const byId = new Map(input.tasks.map(t => [t.id, t]));
	const wid = id => w(byId.get(id));
	const ek = (u, v) => `${u} ${v}`;
	const children = new Map(
		input.tasks.map(t => {
			const seen = new Set(),
				out = [];
			for (const tr of t.next ?? [])
				for (const dd of tr.do ?? [])
					if (ids.has(dd) && !seen.has(dd)) {
						seen.add(dd);
						out.push(dd);
					}
			return [t.id, out];
		}),
	);
	const back = new Set(),
		vis = new Set(),
		stk = new Set();
	const dfs = u => {
		vis.add(u);
		stk.add(u);
		for (const v of children.get(u)) {
			if (stk.has(v)) back.add(ek(u, v));
			else if (!vis.has(v)) dfs(v);
		}
		stk.delete(u);
	};
	const indeg = new Map(input.tasks.map(t => [t.id, 0]));
	for (const t of input.tasks) for (const v of children.get(t.id)) indeg.set(v, indeg.get(v) + 1);
	const roots = input.tasks.filter(t => indeg.get(t.id) === 0).map(t => t.id);
	for (const r of roots.length ? roots : [input.tasks[0].id]) if (!vis.has(r)) dfs(r);
	for (const t of input.tasks) if (!vis.has(t.id)) dfs(t.id);
	const fwd = u => children.get(u).filter(v => !back.has(ek(u, v)));
	const fpar = new Map(input.tasks.map(t => [t.id, []]));
	for (const t of input.tasks) for (const v of fwd(t.id)) fpar.get(v).push(t.id);
	const ranksOf = members => {
		const rank = new Map(),
			pend = new Map();
		for (const id of members) {
			rank.set(id, 0);
			pend.set(id, 0);
		}
		for (const id of members) for (const v of fwd(id)) if (members.has(v)) pend.set(v, pend.get(v) + 1);
		const q = [...members].filter(id => pend.get(id) === 0);
		while (q.length) {
			const u = q.shift();
			for (const v of fwd(u)) {
				if (!members.has(v)) continue;
				if (rank.get(v) < rank.get(u) + 1) rank.set(v, rank.get(u) + 1);
				pend.set(v, pend.get(v) - 1);
				if (pend.get(v) === 0) q.push(v);
			}
		}
		return rank;
	};
	const rankAll = ranksOf(ids);
	const isSide = id => {
		const f = fpar.get(id);
		if (f.length <= MIN_FEEDERS) return false;
		if (fwd(id).length > 1) return false;
		const fr = f.map(p => rankAll.get(p));
		return Math.max(...fr) - Math.min(...fr) >= MIN_SPAN;
	};
	const side = input.tasks.filter(t => isSide(t.id)).map(t => t.id);
	const sideSet = new Set(side);
	const mainSet = new Set(input.tasks.filter(t => !sideSet.has(t.id)).map(t => t.id));
	const mainIds = [...mainSet];
	const rank = mainSet.size ? ranksOf(mainSet) : new Map();
	for (const key of back) {
		const [u, v] = key.split(' ');
		if (mainSet.has(u) && mainSet.has(v)) rank.set(u, rank.get(v));
	}
	const seq = new Map();
	let c = 0;
	const ord = u => {
		if (seq.has(u)) return;
		seq.set(u, c++);
		for (const v of fwd(u)) if (mainSet.has(v)) ord(v);
	};
	const mIndeg = new Map(mainIds.map(id => [id, 0]));
	for (const id of mainIds) for (const v of fwd(id)) if (mainSet.has(v)) mIndeg.set(v, mIndeg.get(v) + 1);
	const mRoots = mainIds.filter(id => mIndeg.get(id) === 0);
	for (const r of mRoots.length ? mRoots : mainIds) ord(r);
	for (const id of mainIds) ord(id);
	const layers = new Map();
	for (const id of mainIds) {
		const r = rank.get(id);
		if (!layers.has(r)) layers.set(r, []);
		layers.get(r).push(id);
	}
	for (const l of layers.values()) l.sort((a, b) => seq.get(a) - seq.get(b));
	const x = new Map();
	const ranks = [...layers.keys()].sort((a, b) => a - b);
	for (const r of ranks) {
		let cur = 0;
		for (const id of layers.get(r)) {
			x.set(id, cur);
			cur += wid(id) + HGAP;
		}
	}
	const mChildren = id => fwd(id).filter(v => mainSet.has(v));
	const mPar = new Map(mainIds.map(id => [id, []]));
	for (const id of mainIds) for (const v of mChildren(id)) mPar.get(v).push(id);
	const cen = id => x.get(id) + wid(id) / 2;
	const place = (row, des) => {
		let pr = -Infinity;
		for (const id of row) {
			const tg = des.has(id) ? des.get(id) : cen(id);
			const left = Math.max(tg - wid(id) / 2, pr + HGAP);
			x.set(id, left);
			pr = left + wid(id);
		}
	};
	for (let s = 0; s < 8; s++) {
		const down = s % 2 === 0;
		for (const r of down ? ranks : [...ranks].reverse()) {
			const des = new Map();
			for (const id of layers.get(r)) {
				const nb = down ? mPar.get(id) : mChildren(id);
				if (nb.length) des.set(id, nb.reduce((a, n) => a + cen(n), 0) / nb.length);
			}
			place(layers.get(r), des);
		}
	}
	const minX = mainIds.length ? Math.min(...mainIds.map(id => x.get(id))) : 0;
	for (const id of mainIds)
		byId.get(id).metadata = {
			...(byId.get(id).metadata ?? {}),
			x: Math.round(x.get(id) - minX),
			y: rank.get(id) * ROW,
		};
	if (side.length) {
		const mainRight = mainIds.length ? Math.max(...mainIds.map(id => x.get(id) - minX + wid(id))) : 0;
		const laneX = mainRight + LANE_GAP;
		const cY = id => {
			const f = fpar.get(id).filter(p => mainSet.has(p));
			const srcRanks = f.length ? f.map(p => rank.get(p)) : [rankAll.get(id)];
			return (srcRanks.reduce((a, r) => a + r, 0) / srcRanks.length) * ROW;
		};
		let prevB = -Infinity;
		for (const id of [...side].sort((a, b) => cY(a) - cY(b))) {
			const y = Math.max(Math.round(cY(id)), prevB + VGAP);
			byId.get(id).metadata = { ...(byId.get(id).metadata ?? {}), x: laneX, y };
			prevB = y + HEIGHT;
		}
	}
	const ob = input.tasks.map(t => ({ x: t.metadata.x, y: t.metadata.y, w: w(t), h: HEIGHT }));
	let overlaps = 0;
	for (let i = 0; i < ob.length; i++)
		for (let j = i + 1; j < ob.length; j++) {
			const a = ob[i],
				b = ob[j];
			if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++;
		}
	console.log('\n=== AUTOLAYOUT (layered + right lane) ===');
	console.log(`side-lane catches: ${side.map(id => byId.get(id).name).join(', ') || '(none)'}`);
	for (const t of [...input.tasks].sort((a, b) => a.metadata.y - b.metadata.y || a.metadata.x - b.metadata.x))
		console.log(
			`  ${sideSet.has(t.id) ? '[LANE]' : 'rank=' + rank.get(t.id)}\t${t.name.slice(0, 28).padEnd(28)} x=${t.metadata.x} y=${t.metadata.y}`,
		);
	console.log(`overlaps: ${overlaps}; mainCount=${mainIds.length}; laneCount=${side.length}`);
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
