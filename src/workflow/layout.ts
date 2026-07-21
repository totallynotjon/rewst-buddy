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

/** A task's canvas position, if its metadata carries finite numeric x/y — a
 * NaN/Infinity coordinate is treated as unpositioned rather than poisoning
 * bounding boxes and shifts downstream. */
export function positionOf(task: RawTask): { x: number; y: number } | undefined {
	const metadata = task.metadata;
	if (metadata && typeof metadata === 'object') {
		const { x, y } = metadata as { x?: unknown; y?: unknown };
		if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
			return { x, y };
		}
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
 * connected from (same column, one node-height-plus-gap down), directly above
 * its first positioned target when it has no positioned parent (so a new root
 * does not sink below its own children), or below the lowest existing node
 * otherwise. If the spot would overlap an existing node, it is nudged right by
 * a node width until clear. Existing positions are never moved.
 * Returns how many tasks were placed.
 */
export function layoutNewTasks(tasks: RawTask[]): number {
	const placed: Box[] = [];
	for (const task of tasks) {
		const position = positionOf(task);
		if (position) placed.push({ x: position.x, y: position.y, w: nodeWidth(task), h: NODE_HEIGHT });
	}
	const baseX = placed.length ? Math.min(...placed.map(b => b.x)) : 0;
	const lowestBottom = placed.length ? Math.max(...placed.map(b => b.y + b.h)) : 0;

	let placedCount = 0;
	const byId = new Map(tasks.map(t => [t.id, t]));
	for (const task of tasks) {
		if (positionOf(task)) continue;
		const parent = tasks.find(candidate => (candidate.next ?? []).some(t => (t.do ?? []).includes(task.id)));
		const parentPosition = parent ? positionOf(parent) : undefined;
		const childPosition = parentPosition
			? undefined
			: (task.next ?? [])
					.flatMap(t => t.do ?? [])
					.map(target => (target === task.id ? undefined : byId.get(target)))
					.map(child => (child ? positionOf(child) : undefined))
					.find(p => p !== undefined);
		const w = nodeWidth(task);
		let x = parentPosition ? parentPosition.x : childPosition ? childPosition.x : baseX;
		const y = parentPosition
			? parentPosition.y + NODE_HEIGHT + V_GAP
			: childPosition
				? childPosition.y - NODE_HEIGHT - V_GAP
				: lowestBottom + V_GAP;
		const padded = (): Box => ({ x: x - H_GAP, y: y - V_GAP, w: w + 2 * H_GAP, h: NODE_HEIGHT + 2 * V_GAP });
		while (placed.some(box => overlaps(padded(), box))) x += w + H_GAP;
		setPosition(task, x, y);
		placed.push({ x, y, w, h: NODE_HEIGHT });
		placedCount++;
	}
	return placedCount;
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

	// 3b. Tighten: pull a task down toward its children when that strictly
	// shortens total line length (strictly more child lines shrink than parent
	// lines grow), so a side root doesn't hang at the top of the canvas with
	// one long line to a deep join (#188). The primary root — the workflow's
	// entry — is exempt so the START anchor never leaves the top row.
	const primaryRoot = roots.length ? roots[0] : firstId;
	for (const id of mainIds.slice().sort((a, b) => rank.get(b)! - rank.get(a)!)) {
		if (id === primaryRoot) continue;
		const kids = forwardChildren(id).filter(v => mainSet.has(v));
		if (kids.length === 0) continue;
		const parents = forwardParents.get(id)!.filter(p => mainSet.has(p));
		if (parents.length > 0 && parents.length >= kids.length) continue;
		const minChild = Math.min(...kids.map(k => rank.get(k)!));
		if (minChild - rank.get(id)! > 1) rank.set(id, minChild - 1);
	}

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

// ---------------------------------------------------------------------------
// Section detection (#188): the smallest single-entry/single-exit chunk of the
// graph containing a set of anchor tasks, found with iterative dominator /
// post-dominator sets (the classic SESE-region characterization: a node is in
// the region when the entry dominates it and the exit post-dominates it),
// then verified directly by counting boundary-crossing transitions.
// ---------------------------------------------------------------------------

export interface SectionInfo {
	/** Section member task ids, in task-array order. */
	memberIds: string[];
	/** The member receiving the single inbound line (undefined for a root). */
	entryId?: string;
	/** The member emitting the single outbound line (undefined for a terminal). */
	exitId?: string;
	/** True when no chunk smaller than the whole workflow isolates the anchors. */
	wholeGraph: boolean;
}

/**
 * Dominator sets by iterative fixed point, restricted to nodes reachable from
 * `root`. dom[v][i] === 1 means node i dominates node v; unreachable nodes get
 * an empty row so they never qualify as candidates or members. The refinement
 * walks nodes in reverse postorder, so it converges in a few passes instead of
 * O(n) passes on chain-shaped graphs.
 */
function computeDominators(succ: number[][], root: number, total: number): Uint8Array[] {
	const pred: number[][] = Array.from({ length: total }, () => []);
	for (let u = 0; u < total; u++) for (const v of succ[u]) pred[v].push(u);

	// Iterative DFS: state 0 = unvisited, 1 = on stack, 2 = done (reachable).
	const state = new Uint8Array(total);
	const order: number[] = [];
	const stack: [number, number][] = [[root, 0]];
	state[root] = 1;
	while (stack.length) {
		const frame = stack[stack.length - 1];
		const u = frame[0];
		if (frame[1] < succ[u].length) {
			const v = succ[u][frame[1]++];
			if (state[v] === 0) {
				state[v] = 1;
				stack.push([v, 0]);
			}
		} else {
			stack.pop();
			state[u] = 2;
			order.push(u);
		}
	}
	order.reverse();

	const reachable = (v: number): boolean => state[v] === 2;
	const dom: Uint8Array[] = Array.from({ length: total }, (_, v) => {
		const row = new Uint8Array(total);
		if (v === root) row[root] = 1;
		else if (reachable(v)) row.fill(1);
		return row;
	});
	let changed = true;
	while (changed) {
		changed = false;
		for (const v of order) {
			if (v === root) continue;
			const preds = pred[v].filter(p => reachable(p));
			const row = dom[v];
			for (let i = 0; i < total; i++) {
				if (i === v || row[i] === 0) continue;
				let keep = true;
				for (const p of preds) {
					if (dom[p][i] === 0) {
						keep = false;
						break;
					}
				}
				if (!keep) {
					row[i] = 0;
					changed = true;
				}
			}
		}
	}
	return dom;
}

/**
 * Finds the smallest section (single inbound transition, single outbound
 * transition, counting loop back-edges as ordinary lines and parallel
 * duplicate transitions as one line) containing every anchor task. When
 * nothing smaller closes — including flows a stray orphaned cycle feeds into —
 * it falls back to the whole graph rather than failing.
 */
export function findSection(tasks: RawTask[], anchorIds: string[]): SectionInfo {
	if (tasks.length === 0) throw new Error('findSection: the workflow has no tasks.');
	const index = new Map(tasks.map((t, i) => [t.id, i]));
	for (const anchor of anchorIds) {
		if (!index.has(anchor)) throw new Error(`findSection: no task with id "${anchor}".`);
	}
	const n = tasks.length;
	const SOURCE = n;
	const SINK = n + 1;
	const total = n + 2;

	const succ: number[][] = Array.from({ length: total }, () => []);
	const edges: [number, number][] = [];
	const edgeSeen = new Set<number>();
	for (const task of tasks) {
		const u = index.get(task.id)!;
		for (const transition of task.next ?? []) {
			for (const target of transition.do ?? []) {
				const v = index.get(target);
				if (v === undefined || edgeSeen.has(u * total + v)) continue;
				edgeSeen.add(u * total + v);
				succ[u].push(v);
				edges.push([u, v]);
			}
		}
	}
	const indegree = Array<number>(n).fill(0);
	for (const [, v] of edges) indegree[v]++;
	const roots = tasks.map((_, i) => i).filter(i => indegree[i] === 0);
	for (const r of roots.length ? roots : [0]) succ[SOURCE].push(r);
	const terminals = tasks.map((_, i) => i).filter(i => succ[i].length === 0);
	for (const t of terminals.length ? terminals : [n - 1]) succ[t].push(SINK);

	const reversed: number[][] = Array.from({ length: total }, () => []);
	for (let u = 0; u < total; u++) for (const v of succ[u]) reversed[v].push(u);

	const dom = computeDominators(succ, SOURCE, total);
	const pdom = computeDominators(reversed, SINK, total);

	const anchorIdx = anchorIds.map(a => index.get(a)!);
	const rowSize = (row: Uint8Array): number => {
		let size = 0;
		for (const bit of row) size += bit;
		return size;
	};
	const candidateEntries: number[] = [];
	const candidateExits: number[] = [];
	for (let i = 0; i < total; i++) {
		if (anchorIdx.every(a => dom[a][i] === 1)) candidateEntries.push(i);
		if (anchorIdx.every(a => pdom[a][i] === 1)) candidateExits.push(i);
	}
	// Nearest (deepest) candidates first: a deeper dominator has more
	// dominators of its own, and near pairs give the small member sets, so the
	// early-exit below usually fires on the first few pairs.
	candidateEntries.sort((a, b) => rowSize(dom[b]) - rowSize(dom[a]) || a - b);
	candidateExits.sort((a, b) => rowSize(pdom[b]) - rowSize(pdom[a]) || a - b);
	const minPossible = new Set(anchorIdx).size;

	let best: Set<number> | undefined;
	let bestBoundary: { entry?: number; exit?: number } = {};
	search: for (const d of candidateEntries) {
		for (const p of candidateExits) {
			const members = new Set<number>();
			for (let v = 0; v < n; v++) if (dom[v][d] === 1 && pdom[v][p] === 1) members.add(v);
			if (members.size === 0 || (best && members.size >= best.size)) continue;
			let entry: number | undefined;
			let exit: number | undefined;
			let inbound = 0;
			let outbound = 0;
			for (const [u, v] of edges) {
				if (!members.has(u) && members.has(v)) {
					inbound++;
					entry = v;
				} else if (members.has(u) && !members.has(v)) {
					outbound++;
					exit = u;
				}
			}
			if (inbound > 1 || outbound > 1) continue;
			// The inbound line must land on the dominator candidate itself and
			// the outbound line must leave from the post-dominator candidate —
			// otherwise a back-edge into the middle of the set would masquerade
			// as the entry (the set is not a canonical single-entry/single-exit
			// region even though only two lines cross it).
			if (inbound === 1 && entry !== d) continue;
			if (outbound === 1 && exit !== p) continue;
			best = members;
			bestBoundary = { entry: inbound === 1 ? entry : undefined, exit: outbound === 1 ? exit : undefined };
			if (best.size <= minPossible) break search;
		}
	}
	if (!best) {
		// No candidate closes — e.g. an orphaned (unreachable) cycle has an edge
		// into the anchors' flow that no member set can absorb. Degrade to the
		// whole graph so the caller can still run a full layout.
		return { memberIds: tasks.map(t => t.id), entryId: undefined, exitId: undefined, wholeGraph: true };
	}
	const chosen = best;
	return {
		memberIds: tasks.filter((_, i) => chosen.has(i)).map(t => t.id),
		entryId: bestBoundary.entry !== undefined ? tasks[bestBoundary.entry].id : undefined,
		exitId: bestBoundary.exit !== undefined ? tasks[bestBoundary.exit].id : undefined,
		wholeGraph: chosen.size === tasks.length,
	};
}

export interface SectionLayoutResult extends SectionInfo {
	/** How many tasks outside the section were shifted to absorb the size change. */
	shifted: number;
	/**
	 * True when the section could not be re-arranged in isolation and a full
	 * canvas layout ran instead (whole-graph section, or a non-member task
	 * sitting inside the section's old bounding box would have been overlapped).
	 */
	usedFullLayout: boolean;
}

interface BBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

function membersBBox(members: RawTask[]): BBox | undefined {
	let minX = Infinity;
	let minY = Infinity;
	let maxRight = -Infinity;
	let maxBottom = -Infinity;
	for (const task of members) {
		const position = positionOf(task);
		if (!position) continue;
		minX = Math.min(minX, position.x);
		minY = Math.min(minY, position.y);
		maxRight = Math.max(maxRight, position.x + nodeWidth(task));
		maxBottom = Math.max(maxBottom, position.y + NODE_HEIGHT);
	}
	if (!Number.isFinite(minX)) return undefined;
	return { x: minX, y: minY, w: maxRight - minX, h: maxBottom - minY };
}

/**
 * Section-scoped auto-layout (#188): finds the smallest single-entry/
 * single-exit chunk containing the anchors, re-lays out only that chunk in
 * place (anchored at its old top-left corner), and band-shifts the untouched
 * surroundings by the chunk's size delta — tasks below the old chunk move
 * down/up by the height change, tasks to its right within its rows move by
 * the width change. When the smallest chunk is the whole workflow this
 * degrades to a full autoLayout.
 */
export function layoutSectionContaining(tasks: RawTask[], anchorIds: string[]): SectionLayoutResult {
	return layoutSection(tasks, findSection(tasks, anchorIds));
}

/** The layout half of layoutSectionContaining, for callers that already found the section. */
export function layoutSection(tasks: RawTask[], section: SectionInfo): SectionLayoutResult {
	if (section.wholeGraph) {
		autoLayout(tasks);
		return { ...section, shifted: 0, usedFullLayout: true };
	}
	const memberSet = new Set(section.memberIds);
	const members = tasks.filter(t => memberSet.has(t.id));
	const old = membersBBox(members);

	// Band-shifting assumes no outside task sits inside the section's old
	// bounding box; a hand-arranged intruder there would be run over by the
	// fresh layout. Degrade to a full re-arrange instead of overlapping it.
	if (old) {
		const intruder = tasks.some(task => {
			if (memberSet.has(task.id)) return false;
			const position = positionOf(task);
			if (!position) return false;
			return (
				position.x < old.x + old.w &&
				old.x < position.x + nodeWidth(task) &&
				position.y < old.y + old.h &&
				old.y < position.y + NODE_HEIGHT
			);
		});
		if (intruder) {
			autoLayout(tasks);
			return { ...section, shifted: 0, usedFullLayout: true };
		}
	}

	autoLayout(members);
	const fresh = membersBBox(members)!;
	if (!old) {
		// Nothing in the section had a position: park it below the existing
		// flow instead of leaving it at the canvas origin.
		const outside = tasks
			.filter(t => !memberSet.has(t.id))
			.map(positionOf)
			.filter(p => p !== undefined);
		if (outside.length) {
			const baseX = Math.min(...outside.map(p => p!.x));
			const bottom = Math.max(...outside.map(p => p!.y + NODE_HEIGHT));
			for (const member of members) {
				const position = positionOf(member)!;
				setPosition(member, position.x - fresh.x + baseX, position.y - fresh.y + bottom + V_GAP);
			}
		}
		return { ...section, shifted: 0, usedFullLayout: false };
	}

	// Anchor the re-laid-out chunk at its old top-left corner.
	const shiftX = old.x - fresh.x;
	const shiftY = old.y - fresh.y;
	for (const member of members) {
		const position = positionOf(member)!;
		setPosition(member, position.x + shiftX, position.y + shiftY);
	}

	const heightDelta = fresh.h - old.h;
	const widthDelta = fresh.w - old.w;
	let shifted = 0;
	for (const task of tasks) {
		if (memberSet.has(task.id)) continue;
		const position = positionOf(task);
		if (!position) continue;
		if (heightDelta !== 0 && position.y >= old.y + old.h) {
			setPosition(task, position.x, position.y + heightDelta);
			shifted++;
			continue;
		}
		const inBand = position.y + NODE_HEIGHT > old.y && position.y < old.y + Math.max(old.h, fresh.h);
		if (widthDelta !== 0 && inBand && position.x >= old.x + old.w) {
			setPosition(task, position.x + widthDelta, position.y);
			shifted++;
		}
	}
	return { ...section, shifted, usedFullLayout: false };
}

// ---------------------------------------------------------------------------
// Line-length limit (#188): flag transitions whose drawn line would be very
// long so the caller can suggest a section autolayout or restructuring.
// ---------------------------------------------------------------------------

/**
 * The longest transition line considered readable, center to center in canvas
 * pixels — about six rank rows or three node widths, calibrated against the
 * geometry constants above.
 */
export const MAX_TRANSITION_LENGTH = 1000;

export interface LongEdge {
	from: string;
	to: string;
	length: number;
}

/** All transitions whose line exceeds `limit`, longest first, deduplicated per task pair. */
export function findLongEdges(tasks: RawTask[], limit: number = MAX_TRANSITION_LENGTH): LongEdge[] {
	const byId = new Map(tasks.map(t => [t.id, t]));
	const seen = new Set<string>();
	const long: LongEdge[] = [];
	for (const task of tasks) {
		const from = positionOf(task);
		if (!from) continue;
		const fromCenter = { x: from.x + nodeWidth(task) / 2, y: from.y + NODE_HEIGHT / 2 };
		for (const transition of task.next ?? []) {
			for (const target of transition.do ?? []) {
				if (target === task.id || seen.has(`${task.id} ${target}`)) continue;
				seen.add(`${task.id} ${target}`);
				const other = byId.get(target);
				const to = other ? positionOf(other) : undefined;
				if (!other || !to) continue;
				const length = Math.hypot(
					to.x + nodeWidth(other) / 2 - fromCenter.x,
					to.y + NODE_HEIGHT / 2 - fromCenter.y,
				);
				if (length > limit) long.push({ from: task.name, to: other.name, length: Math.round(length) });
			}
		}
	}
	return long.sort((a, b) => b.length - a.length);
}
