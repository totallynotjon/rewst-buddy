import * as assert from 'assert';
import { suite, test } from '../test/tdd';
import {
	MAX_TRANSITION_LENGTH,
	autoLayout,
	findLongEdges,
	findSection,
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
			// Full layout normalizes the left edge to 0.
			assert.strictEqual(Math.min(...tasks.map(t => pos(t).x)), 0);
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
});
