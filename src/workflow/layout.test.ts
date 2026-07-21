import * as assert from 'assert';
import { suite, test } from '../test/tdd';
import {
	MAX_TRANSITION_LENGTH,
	autoLayout,
	findLongEdges,
	findSection,
	layoutNewTasks,
	layoutSectionContaining,
	nodeWidth,
	positionOf,
} from './layout';
import type { RawTask } from './types';

// ---------------------------------------------------------------------------
// Geometry mirrored from layout.ts for expectation math.
// ---------------------------------------------------------------------------
const NODE_HEIGHT = 88;
const ROW_STEP = 168; // NODE_HEIGHT + V_GAP

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function node(id: string, targets: string[][] = [], pos?: { x: number; y: number }): RawTask {
	return {
		id,
		name: id,
		actionId: 'noop-id',
		action: { ref: 'core.noop' },
		input: {},
		metadata: pos ? { ...pos } : {},
		next: targets.map(d => ({ when: '{{ SUCCEEDED }}', label: '', do: d, publish: [] })),
	};
}

/** s -> a -> b -> {c, d} -> e -> f: a diamond nested inside a chain. */
function diamondChain(): RawTask[] {
	return [
		node('s', [['a']]),
		node('a', [['b']]),
		node('b', [['c'], ['d']]),
		node('c', [['e']]),
		node('d', [['e']]),
		node('e', [['f']]),
		node('f'),
	];
}

const pos = (t: RawTask) => positionOf(t)!;
const byId = (tasks: RawTask[]) => new Map(tasks.map(t => [t.id, t]));

suite('Unit: workflowLayoutSections', () => {
	suite('findSection()', () => {
		test('finds the smallest single-entry/single-exit chunk around a branch node', () => {
			const section = findSection(diamondChain(), ['b']);
			assert.deepStrictEqual(section.memberIds, ['b', 'c', 'd', 'e']);
			assert.strictEqual(section.entryId, 'b');
			assert.strictEqual(section.exitId, 'e');
			assert.strictEqual(section.wholeGraph, false);
		});

		test('a mid-branch node with one line in and one line out is a section by itself', () => {
			const section = findSection(diamondChain(), ['c']);
			assert.deepStrictEqual(section.memberIds, ['c']);
			assert.strictEqual(section.entryId, 'c');
			assert.strictEqual(section.exitId, 'c');
		});

		test('multiple anchors expand to the smallest chunk containing them all', () => {
			const section = findSection(diamondChain(), ['c', 'd']);
			assert.deepStrictEqual(section.memberIds, ['b', 'c', 'd', 'e']);
		});

		test('a loop stays inside one section — the back edge is not a boundary crossing', () => {
			// s -> a -> b -> c; c loops back to a and exits to d.
			const tasks = [
				node('s', [['a']]),
				node('a', [['b']]),
				node('b', [['c']]),
				node('c', [['a'], ['d']]),
				node('d'),
			];
			const section = findSection(tasks, ['a']);
			assert.deepStrictEqual(section.memberIds, ['a', 'b', 'c']);
			assert.strictEqual(section.entryId, 'a');
			assert.strictEqual(section.exitId, 'c');
		});

		test('falls back to the whole graph when no smaller chunk isolates the anchor', () => {
			// s -> {a, b} -> m -> {x, y} -> t: m always has 2 lines in and 2 out.
			const tasks = [
				node('s', [['a'], ['b']]),
				node('a', [['m']]),
				node('b', [['m']]),
				node('m', [['x'], ['y']]),
				node('x', [['t']]),
				node('y', [['t']]),
				node('t'),
			];
			const section = findSection(tasks, ['m']);
			assert.strictEqual(section.wholeGraph, true);
			assert.strictEqual(section.memberIds.length, tasks.length);
		});

		test('throws on an unknown anchor id', () => {
			assert.throws(() => findSection(diamondChain(), ['nope']), /nope/);
		});

		test('an orphan cycle feeding the main flow falls back to the whole graph instead of throwing', () => {
			// x <-> y is unreachable from any root, and y also feeds m: that edge
			// can never be absorbed, so no candidate closes — degrade, don't fail.
			const tasks = [
				node('s', [['m']]),
				node('m', [['t']]),
				node('t'),
				node('x', [['y']]),
				node('y', [['x'], ['m']]),
			];
			const section = findSection(tasks, ['m']);
			assert.strictEqual(section.wholeGraph, true);
			assert.strictEqual(section.memberIds.length, tasks.length);
		});

		test('an anchor inside an isolated cycle falls back to the whole graph', () => {
			const tasks = [node('s', [['e']]), node('e'), node('x', [['y']]), node('y', [['x']])];
			const section = findSection(tasks, ['x']);
			assert.strictEqual(section.wholeGraph, true);
		});

		test('duplicate parallel transitions to one target count as one inbound line', () => {
			const tasks = [node('s', [['m'], ['m']]), node('m', [['e']]), node('e')];
			const section = findSection(tasks, ['m']);
			assert.deepStrictEqual(section.memberIds, ['m']);
		});
	});

	suite('positionOf()', () => {
		test('rejects non-finite coordinates', () => {
			assert.strictEqual(positionOf(node('a', [], { x: NaN, y: 5 })), undefined);
			assert.strictEqual(positionOf(node('a', [], { x: 5, y: Infinity })), undefined);
			assert.deepStrictEqual(positionOf(node('a', [], { x: -5.5, y: 0 })), { x: -5.5, y: 0 });
		});
	});

	suite('layoutSectionContaining()', () => {
		/**
		 * Chain with a squashed diamond in the middle: every section node sits on
		 * one row, so re-laying out the section grows it by two rows and the
		 * tasks below must shift down by exactly that delta.
		 */
		function squashed(): RawTask[] {
			return [
				node('s', [['a']], { x: 0, y: 0 }),
				node('a', [['sec1']], { x: 0, y: 168 }),
				node('sec1', [['sec2a'], ['sec2b']], { x: 0, y: 336 }),
				node('sec2a', [['sec3']], { x: 0, y: 336 }),
				node('sec2b', [['sec3']], { x: 400, y: 336 }),
				node('sec3', [['z']], { x: 800, y: 336 }),
				node('z', [['end']], { x: 0, y: 500 }),
				node('end', [], { x: 0, y: 700 }),
				// Sits to the right of the old section box, within its rows.
				node('side', [], { x: 2000, y: 336 }),
			];
		}

		test('re-lays out only the section and band-shifts the surroundings by the size delta', () => {
			const tasks = squashed();
			const result = layoutSectionContaining(tasks, ['sec1']);
			assert.deepStrictEqual(result.memberIds, ['sec1', 'sec2a', 'sec2b', 'sec3']);
			const map = byId(tasks);

			// Upstream tasks do not move at all.
			assert.deepStrictEqual(pos(map.get('s')!), { x: 0, y: 0 });
			assert.deepStrictEqual(pos(map.get('a')!), { x: 0, y: 168 });

			// The section is anchored at its old top-left corner.
			const members = ['sec1', 'sec2a', 'sec2b', 'sec3'].map(id => map.get(id)!);
			const minX = Math.min(...members.map(m => pos(m).x));
			const minY = Math.min(...members.map(m => pos(m).y));
			assert.strictEqual(minX, 0);
			assert.strictEqual(minY, 336);

			// The section now spans three rows (sec1 / sec2a+sec2b / sec3).
			assert.strictEqual(pos(map.get('sec2a')!).y, pos(map.get('sec2b')!).y);
			assert.strictEqual(pos(map.get('sec3')!).y - pos(map.get('sec1')!).y, 2 * ROW_STEP);

			// Old box was one row (88 tall); new box is 2*ROW_STEP + 88. Tasks
			// below the old bottom shift down by exactly the height delta.
			const heightDelta = 2 * ROW_STEP;
			assert.deepStrictEqual(pos(map.get('z')!), { x: 0, y: 500 + heightDelta });
			assert.deepStrictEqual(pos(map.get('end')!), { x: 0, y: 700 + heightDelta });

			// The side task shifts horizontally by the width delta of the section.
			const oldRight = 800 + nodeWidth(map.get('sec3')!);
			const newRight = Math.max(...members.map(m => pos(m).x + nodeWidth(m)));
			const widthDelta = newRight - oldRight;
			assert.deepStrictEqual(pos(map.get('side')!), { x: 2000 + widthDelta, y: 336 });
		});

		test('a whole-graph section degrades to a full auto-layout', () => {
			const tasks = [
				node('s', [['a'], ['b']], { x: 5, y: 5 }),
				node('a', [['m']], { x: 5, y: 200 }),
				node('b', [['m']], { x: 500, y: 200 }),
				node('m', [], { x: 5, y: 400 }),
			];
			const result = layoutSectionContaining(tasks, ['s']);
			assert.strictEqual(result.wholeGraph, true);
			assert.strictEqual(result.usedFullLayout, true);
			// Full layout normalizes the left edge to 0.
			assert.strictEqual(Math.min(...tasks.map(t => pos(t).x)), 0);
		});

		test('a corrupt member coordinate is ignored instead of poisoning the anchor', () => {
			const tasks = [
				node('s', [['a']], { x: 0, y: 0 }),
				node('a', [['b']], { x: 0, y: 168 }),
				node('b', [['c'], ['d']], { x: 0, y: 336 }),
				node('c', [['e']], { x: NaN as number, y: 336 }),
				node('d', [['e']], { x: 500, y: 336 }),
				node('e', [['f']], { x: 0, y: 504 }),
				node('f', [], { x: 0, y: 672 }),
			];
			layoutSectionContaining(tasks, ['b']);
			const map = byId(tasks);
			// Anchor survives: the section stays at the finite members' top-left.
			const members = ['b', 'c', 'd', 'e'].map(id => map.get(id)!);
			assert.strictEqual(Math.min(...members.map(m => pos(m).x)), 0);
			assert.strictEqual(Math.min(...members.map(m => pos(m).y)), 336);
			for (const t of tasks) {
				assert.ok(Number.isFinite(pos(t).x) && Number.isFinite(pos(t).y), `${t.id} finite`);
			}
			assert.deepStrictEqual(pos(map.get('s')!), { x: 0, y: 0 }, 'upstream untouched');
		});

		test('an unpositioned section parks below the existing flow, not at the origin', () => {
			// b has no position; s and f do. The single-node section {b} must not
			// land on top of s at (0,0).
			const tasks = [node('s', [['b']], { x: 0, y: 0 }), node('b', [['f']]), node('f', [], { x: 0, y: 600 })];
			layoutSectionContaining(tasks, ['b']);
			const map = byId(tasks);
			assert.deepStrictEqual(pos(map.get('s')!), { x: 0, y: 0 });
			assert.deepStrictEqual(pos(map.get('f')!), { x: 0, y: 600 });
			// Below the lowest existing box (600 + 88) plus the vertical gap.
			assert.deepStrictEqual(pos(map.get('b')!), { x: 0, y: 600 + NODE_HEIGHT + 80 });
		});

		test('a stranger inside the old section box degrades to a full re-arrange without overlaps', () => {
			const tasks = [
				node('a', [['b']], { x: 0, y: -300 }),
				node('b', [['c'], ['d']], { x: 0, y: 0 }),
				node('c', [['e']], { x: 900, y: 100 }),
				node('d', [['e']], { x: 1400, y: 500 }),
				node('e', [['f']], { x: 1800, y: 900 }),
				node('f', [], { x: 0, y: 1200 }),
				// Parked in the hollow of the {b,c,d,e} bounding box.
				node('x', [], { x: 250, y: 100 }),
			];
			const result = layoutSectionContaining(tasks, ['b']);
			assert.strictEqual(result.usedFullLayout, true, 'degrades rather than running the stranger over');
			const box = (t: RawTask) => ({ ...pos(t), w: nodeWidth(t), h: NODE_HEIGHT });
			for (let i = 0; i < tasks.length; i++) {
				for (let j = i + 1; j < tasks.length; j++) {
					const p = box(tasks[i]);
					const q = box(tasks[j]);
					const hit = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
					assert.ok(!hit, `${tasks[i].id} overlaps ${tasks[j].id}`);
				}
			}
		});
	});

	suite('rank tightening', () => {
		test('a side root with one deep child is pulled down next to it', () => {
			// s -> a -> b -> c -> d -> e, plus a lone root r -> e. Without
			// tightening r sits at rank 0 with a 5-row line down to e.
			const tasks = [
				node('s', [['a']]),
				node('a', [['b']]),
				node('b', [['c']]),
				node('c', [['d']]),
				node('d', [['e']]),
				node('e'),
				node('r', [['e']]),
			];
			autoLayout(tasks);
			const map = byId(tasks);
			assert.strictEqual(pos(map.get('r')!).y, pos(map.get('d')!).y, 'r shares the rank right above e');
		});

		test('the primary root is never pulled off the top row', () => {
			// start's only child is a deep join; without the exemption it would
			// sink to the row above j, leaving the workflow entry mid-canvas.
			const tasks = [
				node('start', [['j']]),
				node('r2', [['a']]),
				node('a', [['b']]),
				node('b', [['j']]),
				node('j'),
			];
			autoLayout(tasks);
			assert.strictEqual(pos(byId(tasks).get('start')!).y, 0, 'the entry stays on the top row');
		});

		test('a straight chain is not disturbed by tightening', () => {
			const tasks = diamondChain();
			autoLayout(tasks);
			const map = byId(tasks);
			const ys = ['s', 'a', 'b', 'c', 'e', 'f'].map(id => pos(map.get(id)!).y);
			assert.deepStrictEqual(
				ys,
				[0, 1, 2, 3, 4, 5].map(r => r * ROW_STEP),
			);
			assert.strictEqual(pos(map.get('c')!).y, pos(map.get('d')!).y);
		});
	});

	suite('findLongEdges()', () => {
		test('flags a transition line longer than the limit after layout', () => {
			// A 7-rank chain where the start also skips straight to the last
			// node: that line spans 6 rows (> MAX_TRANSITION_LENGTH).
			const tasks = [
				node('start', [['n1'], ['n6']]),
				node('n1', [['n2']]),
				node('n2', [['n3']]),
				node('n3', [['n4']]),
				node('n4', [['n5']]),
				node('n5', [['n6']]),
				node('n6'),
			];
			autoLayout(tasks);
			const long = findLongEdges(tasks);
			assert.strictEqual(long.length, 1);
			assert.strictEqual(long[0].from, 'start');
			assert.strictEqual(long[0].to, 'n6');
			assert.ok(long[0].length > MAX_TRANSITION_LENGTH);
		});

		test('short flows report no long edges and a tiny limit reports them all', () => {
			const tasks = diamondChain();
			autoLayout(tasks);
			assert.deepStrictEqual(findLongEdges(tasks), []);
			assert.ok(findLongEdges(tasks, 10).length >= 6, 'every drawn edge exceeds a 10px limit');
		});

		test('tasks without positions are skipped instead of crashing', () => {
			const tasks = [node('u', [['v']]), node('v')];
			assert.deepStrictEqual(findLongEdges(tasks), []);
		});
	});

	suite('layoutNewTasks()', () => {
		test('an unpositioned root with a positioned child is placed above the child, not below the flow', () => {
			const tasks = [node('a', [['b']]), node('b', [], { x: 0, y: 300 })];
			layoutNewTasks(tasks);
			assert.deepStrictEqual(pos(tasks[0]), { x: 0, y: 300 - ROW_STEP });
		});

		test('reports how many tasks it placed', () => {
			const tasks = [node('a', [['b']], { x: 0, y: 0 }), node('b'), node('c')];
			assert.strictEqual(layoutNewTasks(tasks), 2);
			assert.strictEqual(layoutNewTasks(tasks), 0);
		});
	});
});
