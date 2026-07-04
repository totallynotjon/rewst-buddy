import {
	RENDER_VERIFY_STEERING,
	WORKFLOW_COMPOSITION_STEERING,
	WORKFLOW_EXECUTION_LOGS_TOOL_NAME,
	WORKFLOW_RUN_TOOL_NAME,
	WORKFLOW_SUMMARY_DETAIL_STEERING,
	WORKFLOW_TOOL_SPECS,
} from '@workflow';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { buildMcpInstructions, MCP_PROMPTS, renderMcpPrompt } from './instructions';

const { suite, test } = Mocha;

suite('Unit: mcpInstructions', () => {
	// -----------------------------------------------------------------------
	// buildMcpInstructions
	// -----------------------------------------------------------------------

	test('contains WORKFLOW_SUMMARY_DETAIL_STEERING verbatim', () => {
		const instructions = buildMcpInstructions();
		assert.ok(
			instructions.includes(WORKFLOW_SUMMARY_DETAIL_STEERING),
			'instructions must contain WORKFLOW_SUMMARY_DETAIL_STEERING verbatim',
		);
	});

	test('contains WORKFLOW_COMPOSITION_STEERING verbatim', () => {
		const instructions = buildMcpInstructions();
		assert.ok(
			instructions.includes(WORKFLOW_COMPOSITION_STEERING),
			'instructions must contain WORKFLOW_COMPOSITION_STEERING verbatim',
		);
	});

	test('contains RENDER_VERIFY_STEERING verbatim', () => {
		const instructions = buildMcpInstructions();
		assert.ok(
			instructions.includes(RENDER_VERIFY_STEERING),
			'instructions must contain RENDER_VERIFY_STEERING verbatim',
		);
	});

	test('contains WORKFLOW_RUN_TOOL_NAME', () => {
		const instructions = buildMcpInstructions();
		assert.ok(
			instructions.includes(WORKFLOW_RUN_TOOL_NAME),
			`instructions must reference ${WORKFLOW_RUN_TOOL_NAME}`,
		);
	});

	test('contains WORKFLOW_EXECUTION_LOGS_TOOL_NAME', () => {
		const instructions = buildMcpInstructions();
		assert.ok(
			instructions.includes(WORKFLOW_EXECUTION_LOGS_TOOL_NAME),
			`instructions must reference ${WORKFLOW_EXECUTION_LOGS_TOOL_NAME}`,
		);
	});

	test('contains buddy_result_read', () => {
		const instructions = buildMcpInstructions();
		assert.ok(instructions.includes('buddy_result_read'), 'instructions must reference buddy_result_read');
	});

	test('contains approval_required', () => {
		const instructions = buildMcpInstructions();
		assert.ok(instructions.includes('approval_required'), 'instructions must reference approval_required');
	});

	// -----------------------------------------------------------------------
	// Single-source guard: steering fragments appear in tool descriptions too
	// -----------------------------------------------------------------------

	test('buddy_workflow_get description contains WORKFLOW_SUMMARY_DETAIL_STEERING', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(s => s.name === 'buddy_workflow_get');
		assert.ok(spec, 'buddy_workflow_get spec must exist');
		assert.ok(
			spec.description.includes(WORKFLOW_SUMMARY_DETAIL_STEERING),
			'buddy_workflow_get description must contain WORKFLOW_SUMMARY_DETAIL_STEERING verbatim',
		);
	});

	test('buddy_workflow_edit description contains WORKFLOW_COMPOSITION_STEERING', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(s => s.name === 'buddy_workflow_edit');
		assert.ok(spec, 'buddy_workflow_edit spec must exist');
		assert.ok(
			spec.description.includes(WORKFLOW_COMPOSITION_STEERING),
			'buddy_workflow_edit description must contain WORKFLOW_COMPOSITION_STEERING verbatim',
		);
	});

	test('buddy_render_jinja description contains RENDER_VERIFY_STEERING', () => {
		const spec = WORKFLOW_TOOL_SPECS.find(s => s.name === 'buddy_render_jinja');
		assert.ok(spec, 'buddy_render_jinja spec must exist');
		assert.ok(
			spec.description.includes(RENDER_VERIFY_STEERING),
			'buddy_render_jinja description must contain RENDER_VERIFY_STEERING verbatim',
		);
	});

	// -----------------------------------------------------------------------
	// MCP_PROMPTS
	// -----------------------------------------------------------------------

	test('MCP_PROMPTS has exactly the three expected names', () => {
		const names = MCP_PROMPTS.map(p => p.name);
		assert.deepStrictEqual(
			new Set(names),
			new Set(['debug-execution', 'safe-workflow-edit', 'compose-sub-workflow']),
		);
		assert.strictEqual(names.length, 3, 'exactly three prompts');
	});

	test('each prompt has a non-empty description', () => {
		for (const prompt of MCP_PROMPTS) {
			assert.ok(
				typeof prompt.description === 'string' && prompt.description.length > 0,
				`prompt "${prompt.name}" must have a non-empty description`,
			);
		}
	});

	// -----------------------------------------------------------------------
	// renderMcpPrompt
	// -----------------------------------------------------------------------

	test('debug-execution with executionId includes the id and execution-log tool', () => {
		const text = renderMcpPrompt('debug-execution', { executionId: 'e-1' });
		assert.ok(text.includes('e-1'), 'rendered text must include the executionId');
		assert.ok(
			text.includes(WORKFLOW_EXECUTION_LOGS_TOOL_NAME),
			`rendered text must reference ${WORKFLOW_EXECUTION_LOGS_TOOL_NAME}`,
		);
	});

	test('safe-workflow-edit renders without arguments', () => {
		assert.doesNotThrow(() => renderMcpPrompt('safe-workflow-edit', {}));
		const text = renderMcpPrompt('safe-workflow-edit', {});
		assert.ok(text.length > 0, 'rendered text must be non-empty');
	});

	test('unknown prompt name throws /unknown prompt/i', () => {
		assert.throws(() => renderMcpPrompt('nope', {}), /unknown prompt/i);
	});
});
