/**
 * Layered auto-layout algorithm for Rewst workflow canvases.
 * Extracted from workflowTools.ts (D1 split).
 *
 * Exports: autoLayout (full re-layout), layoutNewTasks (place only unpositioned
 * tasks), setPosition / positionOf / nodeWidth (geometry helpers used by
 * graphMutations for the add_task position path).
 */

import { type RawTask, orderTransitionsByCondition } from './types';

// ---------------------------------------------------------------------------
// Canvas geometry constants, calibrated from a hand-arranged workflow
// (see scripts/WORKFLOW_API_FINDINGS.md). node.metadata.{x,y} is the node's
// top-left anchor in free (un-snapped) canvas coordinates.
// ---------------------------------------------------------------------------

const NODE_HEIGHT = 88;
const WIDTH_BASE = 209;
const WIDTH_PER_TRANSITION = 127;
const V_GAP = 80;
const H_GAP = 80;

/** Estimated rendered width of a node from its outgoing transition count. */
export function nodeWidth(task: RawTask): number {
	return WIDTH_BASE + WIDTH_PER_TRANSITION * Math.max(1, (task.next ?? []).length);
}

/** A task's canvas position, if its metadata carries numeric x/y. */
export function positionOf(task: RawTask): { x: number; y: number } | undefined {
	const metadata = task.metadata;
	if (metadata && typeof metadata === 'object') {
		const { x, y } = metadata as { x?: unknown; y?: unknown };
		if (typeof x === 'number' && typeof y === 'number') return { x, y };
	}
	return undefined;
}

export function setPosition(task: RawTask, x: number, y: number): void {
	const metadata = task.metadata && typeof task.metadata === 'object' ? { ...(task.metadata as object) } : {};
	task.metadata = { ...metadata, x, y };
}

interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Whether two footprints overlap (touching edges count as clear). */
function overlaps(a: Box, b: Box): boolean {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Places any task that still lacks a position: directly below the action it is
 * connected from (same column, one node-height-plus-gap down), or below the
 * lowest existing node when it has no parent. If the spot would overlap an
 * existing node, it is nudged right by a node width until clear.
 * Existing positions are never moved.
 */
export function layoutNewTasks(tasks: RawTask[]): void {
	const placed: Box[] = [];
	for (const task of tasks) {
		const position = positionOf(task);
		if (position) placed.push({ x: position.x, y: position.y, w: nodeWidth(task), h: NODE_HEIGHT });
	}
	const baseX = placed.length ? Math.min(...placed.map(b => b.x)) : 0;
	const lowestBottom = placed.length ? Math.max(...placed.map(b => b.y + b.h)) : 0;

	for (const task of tasks) {
		if (positionOf(task)) continue;
		const parent = tasks.find(candidate => (candidate.next ?? []).some(t => (t.do ?? []).includes(task.id)));
		const parentBox = parent
			? placed.find(b => positionOf(parent)?.x === b.x && positionOf(parent)?.y === b.y)
			: undefined;
		const w = nodeWidth(task);
		let x = parentBox ? parentBox.x : baseX;
		const y = parentBox ? parentBox.y + NODE_HEIGHT + V_GAP : lowestBottom + V_GAP;
		const padded = (): Box => ({ x: x - H_GAP, y: y - V_GAP, w: w + 2 * H_GAP, h: NODE_HEIGHT + 2 * V_GAP });
		while (placed.some(box => overlaps(padded(), box))) x += w + H_GAP;
		setPosition(task, x, y);
		placed.push({ x, y, w, h: NODE_HEIGHT });
	}
}

// One vertical row per rank.
const ROW_STEP = NODE_HEIGHT + V_GAP;

// A terminal node fed by more than this many actions is treated as a shared
// "catch" rather than a normal endpoint and placed in a side lane.
const SIDE_HANDLER_MIN_FEEDERS = 2; // strictly more than 2 feeders
const SIDE_HANDLER_MIN_SPAN = 5; // feeders must span at least this many ranks
const LANE_GAP = 2 * H_GAP;

/** Ordered, de-duplicated forward child ids of a task, in transition order. */
function orderedChildren(task: RawTask, ids: Set<string>): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const transition of task.next ?? []) {
		for (const target of transition.do ?? []) {
			if (ids.has(target) && !seen.has(target)) {
				seen.add(target);
				out.push(target);
			}
		}
	}
	return out;
}

/**
 * Re-lays-out every task as a layered flow:
 *
 *  - Cycles are broken by DFS; back-edges are excluded from ranking.
 *  - Ranks come from the longest path on the acyclic graph.
 *  - A back-edge's source is pulled to its target's rank (loop stays compact).
 *  - A terminal "catch" fed by many widely-spaced actions is placed in a side
 *    lane to the right rather than dragging long edges down the main flow.
 *  - Within each rank, tasks are ordered by a transition-order pre-order walk.
 *  - X coordinates pack left-to-right, then barycenter sweeps center parents
 *    over their children.
 *
 * Deterministic for a given task/transition order. Overwrites all positions.
 */
export function autoLayout(tasks: RawTask[]): void {
	if (tasks.length === 0) return;
	// Order transitions before reading them: within-rank placement follows
	// transition order, so custom conditions sit left of the success catch-all.
	orderTransitionsByCondition(tasks);
	const ids = new Set(tasks.map(t => t.id));
	const byId = new Map(tasks.map(t => [t.id, t]));
	const children = new Map(tasks.map(t => [t.id, orderedChildren(t, ids)]));
	const edgeKey = (u: string, v: string) => `${u} ${v}`;
	const firstId = tasks[0].id;
	const width = (id: string) => nodeWidth(byId.get(id)!);

	// 1. Break cycles: DFS flags edges to a node on the current stack as back-edges.
	const backEdges = new Set<string>();
	const visited = new Set<string>();
	const stack = new Set<string>();
	const dfs = (u: string): void => {
		visited.add(u);
		stack.add(u);
		for (const v of children.get(u)!) {
			if (stack.has(v)) backEdges.add(edgeKey(u, v));
			else if (!visited.has(v)) dfs(v);
		}
		stack.delete(u);
	};
	const indegree = new Map(tasks.map(t => [t.id, 0]));
	for (const t of tasks) for (const v of children.get(t.id)!) indegree.set(v, (indegree.get(v) ?? 0) + 1);
	const roots = tasks.filter(t => (indegree.get(t.id) ?? 0) === 0).map(t => t.id);
	for (const r of roots.length ? roots : [firstId]) if (!visited.has(r)) dfs(r);
	for (const t of tasks) if (!visited.has(t.id)) dfs(t.id);

	const forwardChildren = (u: string) => children.get(u)!.filter(v => !backEdges.has(edgeKey(u, v)));
	const forwardParents = new Map<string, string[]>(tasks.map(t => [t.id, []]));
	for (const t of tasks) for (const v of forwardChildren(t.id)) forwardParents.get(v)!.push(t.id);

	// Longest-path ranks over a node subset.
	const computeRanks = (members: Set<string>): Map<string, number> => {
		const rank = new Map<string, number>();
		const pending = new Map<string, number>();
		for (const id of members) {
			rank.set(id, 0);
			pending.set(id, 0);
		}
		for (const id of members)
			for (const v of forwardChildren(id)) if (members.has(v)) pending.set(v, pending.get(v)! + 1);
		const queue = [...members].filter(id => pending.get(id) === 0);
		while (queue.length) {
			const u = queue.shift()!;
			for (const v of forwardChildren(u)) {
				if (!members.has(v)) continue;
				if (rank.get(v)! < rank.get(u)! + 1) rank.set(v, rank.get(u)! + 1);
				pending.set(v, pending.get(v)! - 1);
				if (pending.get(v) === 0) queue.push(v);
			}
		}
		return rank;
	};

	// 2. Detect terminal catch nodes and lay out the main flow without them.
	const rankAll = computeRanks(ids);
	const isSideHandler = (id: string): boolean => {
		const feeders = forwardParents.get(id)!;
		if (feeders.length <= SIDE_HANDLER_MIN_FEEDERS) return false;
		if (forwardChildren(id).length > 1) return false;
		const feederRanks = feeders.map(p => rankAll.get(p)!);
		return Math.max(...feederRanks) - Math.min(...feederRanks) >= SIDE_HANDLER_MIN_SPAN;
	};
	const sideHandlers = tasks.filter(t => isSideHandler(t.id)).map(t => t.id);
	const sideSet = new Set(sideHandlers);
	const mainSet = new Set(tasks.filter(t => !sideSet.has(t.id)).map(t => t.id));
	const mainIds = [...mainSet];

	// 3. Rank the main flow, then apply the loop exception to its back-edges.
	const rank = mainSet.size ? computeRanks(mainSet) : new Map<string, number>();
	for (const key of backEdges) {
		const [u, v] = key.split(' ');
		if (mainSet.has(u) && mainSet.has(v)) rank.set(u, rank.get(v)!);
	}

	// 4. Transition-order pre-order over the main flow drives within-rank order.
	const seq = new Map<string, number>();
	let counter = 0;
	const order = (u: string): void => {
		if (seq.has(u)) return;
		seq.set(u, counter++);
		for (const v of forwardChildren(u)) if (mainSet.has(v)) order(v);
	};
	const mainIndegree = new Map(mainIds.map(id => [id, 0]));
	for (const id of mainIds)
		for (const v of forwardChildren(id)) if (mainSet.has(v)) mainIndegree.set(v, mainIndegree.get(v)! + 1);
	const mainRoots = mainIds.filter(id => mainIndegree.get(id) === 0);
	for (const r of mainRoots.length ? mainRoots : mainIds) order(r);
	for (const id of mainIds) order(id);

	// 5. Group the main flow into rank rows, ordered by transition sequence.
	const layers = new Map<number, string[]>();
	for (const id of mainIds) {
		const r = rank.get(id)!;
		if (!layers.has(r)) layers.set(r, []);
		layers.get(r)!.push(id);
	}
	for (const layer of layers.values()) layer.sort((a, b) => seq.get(a)! - seq.get(b)!);

	// 6. X coordinates: pack each row, then barycenter sweeps center over neighbors.
	const x = new Map<string, number>();
	const ranks = [...layers.keys()].sort((a, b) => a - b);
	for (const r of ranks) {
		let cursor = 0;
		for (const id of layers.get(r)!) {
			x.set(id, cursor);
			cursor += width(id) + H_GAP;
		}
	}
	const mainChildren = (id: string) => forwardChildren(id).filter(v => mainSet.has(v));
	const mainParents = new Map<string, string[]>(mainIds.map(id => [id, []]));
	for (const id of mainIds) for (const v of mainChildren(id)) mainParents.get(v)!.push(id);
	const center = (id: string) => x.get(id)! + width(id) / 2;
	const placeRow = (row: string[], desired: Map<string, number>) => {
		let prevRight = -Infinity;
		for (const id of row) {
			const target = desired.has(id) ? desired.get(id)! : center(id);
			const left = Math.max(target - width(id) / 2, prevRight + H_GAP);
			x.set(id, left);
			prevRight = left + width(id);
		}
	};
	for (let sweep = 0; sweep < 8; sweep++) {
		const downward = sweep % 2 === 0;
		for (const r of downward ? ranks : [...ranks].reverse()) {
			const desired = new Map<string, number>();
			for (const id of layers.get(r)!) {
				const neighbors = downward ? mainParents.get(id)! : mainChildren(id);
				if (neighbors.length) {
					desired.set(id, neighbors.reduce((sum, n) => sum + center(n), 0) / neighbors.length);
				}
			}
			placeRow(layers.get(r)!, desired);
		}
	}

	// 7. Write the main flow as top-left anchors, normalized so the left edge is 0.
	const minX = mainIds.length ? Math.min(...mainIds.map(id => x.get(id)!)) : 0;
	for (const id of mainIds) setPosition(byId.get(id)!, Math.round(x.get(id)! - minX), rank.get(id)! * ROW_STEP);

	// 8. Place catch nodes in a lane to the right, each centered on its feeders'
	//    rows and stacked so they never overlap.
	if (sideHandlers.length) {
		const mainRight = mainIds.length ? Math.max(...mainIds.map(id => x.get(id)! - minX + width(id))) : 0;
		const laneX = mainRight + LANE_GAP;
		const centroidY = (id: string): number => {
			const feeders = forwardParents.get(id)!.filter(p => mainSet.has(p));
			const source = feeders.length ? feeders.map(p => rank.get(p)!) : [rankAll.get(id)!];
			return (source.reduce((sum, r) => sum + r, 0) / source.length) * ROW_STEP;
		};
		let prevBottom = -Infinity;
		for (const id of [...sideHandlers].sort((a, b) => centroidY(a) - centroidY(b))) {
			const y = Math.max(Math.round(centroidY(id)), prevBottom + V_GAP);
			setPosition(byId.get(id)!, laneX, y);
			prevBottom = y + NODE_HEIGHT;
		}
	}
}
