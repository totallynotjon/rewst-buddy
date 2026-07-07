/**
 * C2.4 schema parity test — frozen LEGACY_SCHEMAS fixture.
 *
 * This file captures the 16 hand-written inputSchema objects from
 * rewstReadCapabilities.ts exactly as they existed BEFORE the Zod migration.
 * After migration, the derived schemas are compared field-by-field against
 * this fixture to ensure no required field was dropped, no type changed, and
 * no description was silently lost.
 *
 * The four checks per tool:
 *   1. required fields (as a Set) match exactly.
 *   2. every legacy property key exists in the derived schema.
 *   3. every legacy property's type matches the derived property's type.
 *   4. every legacy property that had an enum has the same values (as a Set).
 *   5. every legacy property that had a description has a non-empty description
 *      in the derived schema.
 *
 * Runner: mocha / extension-host (same suite as rewstReadCapabilities.test.ts).
 */

import * as assert from 'assert';
import * as Mocha from 'mocha';

const { suite, test } = Mocha;

// ---------------------------------------------------------------------------
// Frozen legacy schemas — verbatim copy of the pre-migration inputSchema
// objects. Do NOT update these when migrating; they are the regression guard.
// ---------------------------------------------------------------------------

interface LegacyProperty {
	type: string;
	description?: string;
	enum?: readonly string[];
}

interface LegacySchema {
	properties: Record<string, LegacyProperty>;
	required?: string[];
}

const ORG_ID_DESC = 'Rewst organization id the operation runs against (from buddy_list_orgs).';

const LEGACY_SCHEMAS: Record<string, LegacySchema> = {
	buddy_list_orgs: {
		properties: {},
	},
	buddy_search_templates: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			search: { type: 'string', description: 'Optional case-insensitive name substring.' },
			limit: { type: 'number', description: 'Max templates to return (default 50, max 200).' },
		},
		required: ['orgId'],
	},
	buddy_get_template: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			templateId: { type: 'string', description: 'Template id to fetch.' },
		},
		required: ['orgId', 'templateId'],
	},
	buddy_list_workflows: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			search: { type: 'string', description: 'Optional case-insensitive name filter.' },
			limit: { type: 'number', description: 'Max workflows to return (default 100).' },
		},
		required: ['orgId'],
	},
	buddy_list_org_variables: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			search: { type: 'string', description: 'Optional case-insensitive name substring filter.' },
			limit: { type: 'number', description: 'Max variables to return (default 50, max 200).' },
		},
		required: ['orgId'],
	},

	buddy_find_executions_by_variable: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			workflowId: { type: 'string', description: 'The workflow whose executions to scan.' },
			name: { type: 'string', description: 'Case-insensitive substring matched against variable names.' },
			kind: {
				type: 'string',
				enum: ['input', 'output', 'context'],
				description: "Which variable surface to search: input (default), output, or context (the run's CTX).",
			},
			value: {
				type: 'string',
				description: "Optional case-insensitive substring the matched variable's value must contain.",
			},
			limit: { type: 'number', description: 'Max executions to scan, most-recent first (default 25, max 100).' },
		},
		required: ['orgId', 'workflowId', 'name'],
	},
	buddy_list_workflow_tasks: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			workflowId: { type: 'string', description: 'Workflow id whose tasks to list.' },
			limit: { type: 'number', description: 'Max tasks to return (default 100, max 500).' },
		},
		required: ['orgId', 'workflowId'],
	},
	buddy_list_workflow_patches: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			workflowId: { type: 'string', description: 'Workflow id whose patch history to list.' },
			limit: { type: 'number', description: 'Max patches to return (default 25, max 100).' },
		},
		required: ['orgId', 'workflowId'],
	},
	buddy_get_workflow_patch: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			patchId: { type: 'string', description: 'Workflow patch id to fetch.' },
		},
		required: ['orgId', 'patchId'],
	},

	buddy_get_workflow_execution_stats: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			createdSince: {
				type: 'string',
				description: 'ISO-8601 date string such as 2025-01-01 or 2025-01-01T00:00:00Z.',
			},
		},
		required: ['orgId', 'createdSince'],
	},

	buddy_resolve_reference: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			modelType: {
				type: 'string',
				enum: [
					'Crate',
					'CustomDatabase',
					'Organization',
					'PackConfig',
					'Role',
					'Template',
					'TemplateExport',
					'User',
					'Workflow',
					'Trigger',
					'Form',
					'Site',
					'Page',
				],
				description: 'Which kind of Rewst object to resolve.',
			},
			search: { type: 'string', description: 'Optional case-insensitive name substring filter.' },
			limit: { type: 'number', description: 'Max references to return (default 25, max 100).' },
		},
		required: ['orgId', 'modelType'],
	},
	buddy_get_workflow: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			workflowId: { type: 'string', description: 'Workflow id to fetch.' },
		},
		required: ['orgId', 'workflowId'],
	},
	buddy_graphql_query: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			query: { type: 'string', description: 'GraphQL query document (no mutations or subscriptions).' },
			variables: { type: 'object', description: 'Optional GraphQL variables.' },
		},
		required: ['orgId', 'query'],
	},
};

// ---------------------------------------------------------------------------
// Import the live capability registry so we can read the derived inputSchemas
// ---------------------------------------------------------------------------

import { getCapability } from './registry';

// ---------------------------------------------------------------------------
// Parity assertions
// ---------------------------------------------------------------------------

suite('Unit: rewstReadCapabilities.schemaParity', () => {
	for (const [toolName, legacy] of Object.entries(LEGACY_SCHEMAS)) {
		test(`${toolName} — required fields match`, () => {
			const cap = getCapability(toolName);
			assert.ok(cap, `capability ${toolName} must be registered`);
			const derived = cap.spec.inputSchema as {
				properties?: Record<string, { type: string; enum?: string[]; description?: string }>;
				required?: string[];
			};

			const legacyRequired = new Set(legacy.required ?? []);
			const derivedRequired = new Set(derived.required ?? []);
			assert.deepStrictEqual(
				derivedRequired,
				legacyRequired,
				`${toolName}: required fields mismatch — derived ${JSON.stringify([...derivedRequired])} vs legacy ${JSON.stringify([...legacyRequired])}`,
			);
		});

		test(`${toolName} — all legacy property keys present in derived schema`, () => {
			const cap = getCapability(toolName);
			assert.ok(cap, `capability ${toolName} must be registered`);
			const derived = cap.spec.inputSchema as {
				properties?: Record<string, { type: string; enum?: string[]; description?: string }>;
			};
			const derivedProps = derived.properties ?? {};

			for (const key of Object.keys(legacy.properties)) {
				assert.ok(key in derivedProps, `${toolName}: legacy property "${key}" is missing from derived schema`);
			}
		});

		test(`${toolName} — property types and enums match`, () => {
			const cap = getCapability(toolName);
			assert.ok(cap, `capability ${toolName} must be registered`);
			const derived = cap.spec.inputSchema as {
				properties?: Record<string, { type: string; enum?: string[]; description?: string }>;
			};
			const derivedProps = derived.properties ?? {};

			for (const [key, legacyProp] of Object.entries(legacy.properties)) {
				if (!(key in derivedProps)) continue; // already caught by previous test
				const derivedProp = derivedProps[key];

				assert.strictEqual(
					derivedProp.type,
					legacyProp.type,
					`${toolName}.${key}: type changed from "${legacyProp.type}" to "${derivedProp.type}"`,
				);

				if (legacyProp.enum) {
					assert.ok(
						Array.isArray(derivedProp.enum),
						`${toolName}.${key}: legacy had enum but derived has none`,
					);
					assert.deepStrictEqual(
						new Set(derivedProp.enum),
						new Set(legacyProp.enum),
						`${toolName}.${key}: enum values changed`,
					);
				}
			}
		});

		test(`${toolName} — descriptions present for all legacy-described properties`, () => {
			const cap = getCapability(toolName);
			assert.ok(cap, `capability ${toolName} must be registered`);
			const derived = cap.spec.inputSchema as {
				properties?: Record<string, { type: string; enum?: string[]; description?: string }>;
			};
			const derivedProps = derived.properties ?? {};

			for (const [key, legacyProp] of Object.entries(legacy.properties)) {
				if (!legacyProp.description) continue;
				if (!(key in derivedProps)) continue; // already caught
				const derivedDesc = derivedProps[key].description;
				assert.ok(
					typeof derivedDesc === 'string' && derivedDesc.length > 0,
					`${toolName}.${key}: legacy had a description but derived has none or empty`,
				);
			}
		});
	}
});
