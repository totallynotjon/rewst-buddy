/**
 * Single-source workflow edit field lists and generated grammar snippets.
 *
 * The edit engine uses the sets for validation; the tool spec uses the ordered
 * arrays to describe the same accepted fields. Keep prose generated from these
 * arrays so adding a field cannot silently drift the model guidance.
 */

export const ADD_TASK_FIELD_NAMES = [
	'op',
	'id',
	'name',
	'action',
	'subWorkflowId',
	'input',
	'publishResultAs',
	'timeout',
	'description',
	'with',
	'runAsOrgId',
	'packOverrides',
	'isMocked',
	'mockInput',
	'retry',
	'x',
	'y',
	// Accepted only so the edit engine can report the existing ignored-controls note.
	'transitionMode',
	'join',
] as const;

export const UPDATE_TASK_SET_FIELD_NAMES = [
	'name',
	'input',
	'action',
	'subWorkflowId',
	'publishResultAs',
	'timeout',
	'description',
	'with',
	'runAsOrgId',
	'packOverrides',
	'isMocked',
	'mockInput',
	'retry',
	// Accepted only so the edit engine can report the existing ignored-controls note.
	'transitionMode',
	'join',
] as const;

export const PACK_OVERRIDE_FIELD_NAMES = [
	'packId',
	'packConfigId',
	'configSelectionMode',
	'configFallbackMode',
	'searchInput',
] as const;

export const RETRY_FIELD_NAMES = ['count', 'delay', 'when'] as const;

export const ADD_TASK_FIELDS = new Set<string>(ADD_TASK_FIELD_NAMES);
export const UPDATE_TASK_SET_FIELDS = new Set<string>(UPDATE_TASK_SET_FIELD_NAMES);
export const PACK_OVERRIDE_FIELDS = new Set<string>(PACK_OVERRIDE_FIELD_NAMES);
export const RETRY_FIELDS = new Set<string>(RETRY_FIELD_NAMES);

const HIDDEN_TASK_FIELDS = new Set(['op', 'id', 'transitionMode', 'join']);

function optionalFields(fields: readonly string[], hidden = HIDDEN_TASK_FIELDS): string[] {
	return fields.filter(field => !hidden.has(field)).map(field => `${field}?`);
}

function addTaskGrammar(): string {
	const optional = optionalFields(
		ADD_TASK_FIELD_NAMES.filter(field => !['name', 'action', 'subWorkflowId'].includes(field)),
	);
	return `add_task {name, action (ref or id) OR subWorkflowId, ${optional.join(', ')}}`;
}

function updateTaskGrammar(): string {
	const optional = UPDATE_TASK_SET_FIELD_NAMES.flatMap(field => {
		if (HIDDEN_TASK_FIELDS.has(field)) return [];
		if (field === 'subWorkflowId') return [];
		if (field === 'action') return ['action? or subWorkflowId?'];
		return [`${field}?`];
	});
	return `update_task {id|name, set:{${optional.join(', ')}}}`;
}

export function workflowEditOperationGrammar(): string {
	return [
		'Operations (each an object with an "op" field):',
		addTaskGrammar(),
		updateTaskGrammar(),
		'delete_task {id|name} (also removes edges pointing at it)',
		'connect {from, to, when?, label?, publish?} (from/to are task names or ids)',
		'disconnect {from, to?|transitionId?}',
		'set_transition {from, to?|transitionId?, set:{when?, label?, publish?, to?}}',
		'reposition {task, x, y} (move a task to canvas coordinates)',
		'set_inputs {inputs: [{name, type?, title?, default?, description?, required?, multiline?}]} (replace the workflow\'s run/call inputs; an input default is a Jinja expression like "{{ false }}" or "{{ CTX.x }}" — raw booleans/numbers are wrapped for you)',
		'set_output {outputs: {name: "<jinja>"} object or [{name, value}] array} (replace the workflow\'s caller-visible outputs; raw booleans/numbers are wrapped for you)',
	].join('; ');
}
