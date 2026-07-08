/**
 * C2 phase 2 schema parity test — frozen LEGACY_SCHEMAS fixture.
 *
 * Captures the hand-written inputSchema objects from the 9 target capability
 * files exactly as they existed BEFORE the Zod migration. After migration,
 * the derived schemas are compared field-by-field against this fixture to
 * ensure no required field was dropped, no type changed, and no description
 * was silently lost.
 *
 * Runner: mocha / extension-host (same suite as rewstReadCapabilities.schemaParity.test.ts).
 */

import * as assert from 'assert';
import * as Mocha from 'mocha';
import { JINJA_DOCS_CAPABILITIES } from './jinjaDocsCapabilities';
import { ORG_USER_CAPABILITIES } from './orgUserCapabilities';
import { PACK_INTEGRATION_CAPABILITIES } from './packIntegrationCapabilities';
import { PAGE_TEMPLATE_CAPABILITIES } from './pageTemplateCapabilities';
import { resultReadCapability } from './resultReadCapability';
import { TEMPLATE_CLONE_CAPABILITIES } from './templateCloneCapabilities';
import { TEMPLATE_LINK_CAPABILITIES } from './templateLinkCapabilities';
import { TEMPLATE_SYNC_CAPABILITIES } from './templateSyncCapabilities';
import { TRIGGER_FORM_CAPABILITIES } from './triggerFormCapabilities';

const { suite, test } = Mocha;

// ---------------------------------------------------------------------------
// Frozen legacy schemas — verbatim copy of the pre-migration inputSchema
// objects. Do NOT update these when migrating; they are the regression guard.
// ---------------------------------------------------------------------------

interface LegacyProperty {
	type: string;
	description?: string;
	items?: { type: string; enum?: readonly string[] };
	enum?: readonly string[];
}

interface LegacySchema {
	properties: Record<string, LegacyProperty>;
	required?: string[];
}

interface SchemaProperty {
	type?: string;
	description?: string;
	enum?: readonly string[];
	items?: SchemaProperty;
}

const ORG_ID_DESC = 'Rewst organization id the operation runs against (from buddy_list_orgs).';

const LEGACY_SCHEMAS: Record<string, LegacySchema> = {
	// --- triggerFormCapabilities ---
	buddy_list_triggers: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			limit: { type: 'number', description: 'Max triggers to return (default 50, max 200).' },
		},
		required: ['orgId'],
	},
	buddy_list_forms: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			limit: { type: 'number', description: 'Max forms to return (default 50, max 200).' },
		},
		required: ['orgId'],
	},
	buddy_list_tags: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			limit: { type: 'number', description: 'Max tags to return (default 100, max 500).' },
		},
		required: ['orgId'],
	},
	buddy_list_org_trigger_instances: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			limit: {
				type: 'number',
				description: 'Max trigger activation instances to return (default 50, max 200).',
			},
		},
		required: ['orgId'],
	},
	buddy_get_trigger_error_status: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			triggerIds: { type: 'array', items: { type: 'string' }, description: 'Trigger ids to check.' },
		},
		required: ['orgId', 'triggerIds'],
	},
	// --- packIntegrationCapabilities ---
	buddy_list_installed_packs: {
		properties: { orgId: { type: 'string', description: ORG_ID_DESC } },
		required: ['orgId'],
	},
	buddy_get_pack_auth_status: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			packName: { type: 'string', description: 'A pack ref, e.g. microsoft_graph' },
		},
		required: ['orgId', 'packName'],
	},
	buddy_list_pack_configs: {
		properties: { orgId: { type: 'string', description: ORG_ID_DESC } },
		required: ['orgId'],
	},
	buddy_list_integrations: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			limit: { type: 'number', description: 'Max integrations to return (default 50, max 200).' },
		},
		required: ['orgId'],
	},
	// --- orgUserCapabilities ---
	buddy_search_organizations: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			search: { type: 'string', description: 'Optional case-insensitive name substring.' },
			limit: { type: 'integer', description: 'Max organizations to return (default 25, max 100).' },
		},
		required: ['orgId'],
	},
	buddy_list_users: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			search: { type: 'string', description: 'Optional username substring.' },
			limit: { type: 'integer', description: 'Max users to return (default 50, max 200).' },
		},
		required: ['orgId'],
	},
	buddy_list_roles: {
		properties: { orgId: { type: 'string', description: ORG_ID_DESC } },
		required: ['orgId'],
	},
	// --- pageTemplateCapabilities ---
	buddy_search_templates: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			search: { type: 'string', description: 'Optional case-insensitive name substring.' },
			limit: { type: 'number', description: 'Max templates to return (default 50, max 200).' },
		},
		required: ['orgId'],
	},
	buddy_list_pages: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			limit: { type: 'number', description: 'Max pages to return (default 50, max 200).' },
		},
		required: ['orgId'],
	},
	buddy_list_sites: {
		properties: { orgId: { type: 'string', description: ORG_ID_DESC } },
		required: ['orgId'],
	},
	// --- jinjaDocsCapabilities ---
	buddy_get_jinja_filter_docs: {
		properties: {
			name: {
				type: 'string',
				description: 'Exact filter name to fetch full documentation for (case-insensitive).',
			},
			search: {
				type: 'string',
				description: 'Keyword to match against filter names and documentation.',
			},
		},
		required: [],
	},
	// --- resultReadCapability ---
	buddy_result_read: {
		properties: {
			id: { type: 'string', description: 'Cached result id returned by an oversized Rewst Buddy tool result.' },
			offset: { type: 'number', description: 'Character offset to start reading from (default 0).' },
			limit: { type: 'number', description: 'Maximum characters to return (default 6000, max 8000).' },
			search: {
				type: 'string',
				description: 'Search text; returns matching lines with line numbers instead of a slice.',
			},
		},
		required: ['id'],
	},
	// --- templateLinkCapabilities ---
	buddy_template_link: {
		properties: {
			templateId: {
				type: 'string',
				description: 'Id of the existing Rewst template to link the file to (from buddy_search_templates).',
			},
			uri: {
				type: 'string',
				description:
					'Absolute path, workspace-relative path, or file:// URI of the existing local file to link.',
			},
			orgId: {
				type: 'string',
				description:
					'Optional org id to verify the template belongs to. Defaults to the template\u2019s own org.',
			},
			overwrite: {
				type: 'boolean',
				description:
					'If the file is already linked, replace the existing link instead of failing. Default false.',
			},
		},
		required: ['templateId', 'uri'],
	},
	buddy_template_link_status: {
		properties: {
			uri: {
				type: 'string',
				description: 'Absolute path, workspace-relative path, or file:// URI of the local file to check.',
			},
		},
		required: ['uri'],
	},
	buddy_template_unlink: {
		properties: {
			uri: {
				type: 'string',
				description: 'Path or file URI of the linked file, as shown by buddy_search_template_links.',
			},
		},
		required: ['uri'],
	},
	buddy_template_sync_on_save: {
		properties: {
			uri: { type: 'string', description: 'Path or file URI of the linked file.' },
			enabled: {
				type: 'boolean',
				description: 'true to enable sync-on-save (upload on save), false to disable.',
			},
		},
		required: ['uri', 'enabled'],
	},
	// --- templateSyncCapabilities (read spec only) ---
	buddy_template_sync_status: {
		properties: {
			uri: {
				type: 'string',
				description: 'Path or file URI of the linked file, as shown by buddy_search_template_links.',
			},
		},
		required: ['uri'],
	},
	// --- templateCloneCapabilities ---
	buddy_template_bundle_clone: {
		properties: {
			orgId: { type: 'string', description: ORG_ID_DESC },
			rootTemplateId: { type: 'string', description: 'Id of the root template to deep-clone.' },
			sourceOrgId: {
				type: 'string',
				description:
					'Optional id of the org the root and its references live in. Verified against the root; defaults to the root\u2019s org.',
			},
			namePrefix: { type: 'string', description: 'Optional prefix for cloned template names.' },
			nameSuffix: {
				type: 'string',
				description: 'Optional suffix for cloned template names. Defaults to " (copy)".',
			},
			maxTemplates: {
				type: 'number',
				description: 'Max total templates to clone (root + references). Default 50, capped at 200.',
			},
			maxDepth: { type: 'number', description: 'Max reference depth to walk. Default 10, capped at 25.' },
		},
		required: ['orgId', 'rootTemplateId'],
	},
};

// ---------------------------------------------------------------------------
// Helpers (same contract as rewstReadCapabilities.schemaParity.test.ts)
// ---------------------------------------------------------------------------

function getSchema(cap: { spec: { inputSchema?: unknown } }): {
	properties: Record<string, { type?: string; description?: string; enum?: string[]; items?: SchemaProperty }>;
	required?: string[];
} {
	return (cap.spec.inputSchema ?? { properties: {} }) as ReturnType<typeof getSchema>;
}

function assertSchemaParity(toolName: string, legacy: LegacySchema, derived: ReturnType<typeof getSchema>): void {
	// 1. required fields match
	const legacyRequired = new Set(legacy.required ?? []);
	const derivedRequired = new Set(derived.required ?? []);
	for (const field of legacyRequired) {
		assert.ok(derivedRequired.has(field), `${toolName}: required field "${field}" missing from derived schema`);
	}
	for (const field of derivedRequired) {
		assert.ok(legacyRequired.has(field), `${toolName}: field "${field}" became required unexpectedly`);
	}

	// 2. every legacy property key exists in derived
	for (const key of Object.keys(legacy.properties)) {
		assert.ok(key in (derived.properties ?? {}), `${toolName}: property "${key}" missing from derived schema`);
	}

	// 3. type matches (number/integer both acceptable for integer fields)
	for (const [key, legacyProp] of Object.entries(legacy.properties)) {
		const derivedProp = derived.properties[key];
		if (!derivedProp) continue;
		const legacyType = legacyProp.type;
		const derivedType = derivedProp.type;
		const typesCompatible =
			legacyType === derivedType ||
			(legacyType === 'integer' && derivedType === 'number') ||
			(legacyType === 'number' && derivedType === 'integer');
		assert.ok(
			typesCompatible,
			`${toolName}.${key}: type mismatch — legacy "${legacyType}" vs derived "${derivedType}"`,
		);
		if (legacyProp.type === 'array' && legacyProp.items) {
			assert.strictEqual(
				derivedProp.items?.type,
				legacyProp.items.type,
				`${toolName}.${key}: array item type mismatch`,
			);
			if (legacyProp.items.enum) {
				const legacyItemEnums = new Set(legacyProp.items.enum);
				const derivedItemEnums = new Set(derivedProp.items?.enum ?? []);
				for (const v of legacyItemEnums) {
					assert.ok(derivedItemEnums.has(v), `${toolName}.${key}: array item enum value "${v}" missing`);
				}
			}
		}
	}

	// 4. enum values match when present
	for (const [key, legacyProp] of Object.entries(legacy.properties)) {
		if (!legacyProp.enum) continue;
		const derivedProp = derived.properties[key];
		if (!derivedProp?.enum) continue;
		const legacyEnums = new Set(legacyProp.enum);
		const derivedEnums = new Set(derivedProp.enum);
		for (const v of legacyEnums) {
			assert.ok(derivedEnums.has(v), `${toolName}.${key}: enum value "${v}" missing from derived schema`);
		}
	}

	// 5. description present when legacy had one
	for (const [key, legacyProp] of Object.entries(legacy.properties)) {
		if (!legacyProp.description) continue;
		const derivedProp = derived.properties[key];
		if (!derivedProp) continue;
		assert.ok(
			typeof derivedProp.description === 'string' && derivedProp.description.length > 0,
			`${toolName}.${key}: description missing from derived schema`,
		);
	}
}

// ---------------------------------------------------------------------------
// Collect all capabilities by tool name
// ---------------------------------------------------------------------------

const ALL_CAPS = [
	...TRIGGER_FORM_CAPABILITIES,
	...PACK_INTEGRATION_CAPABILITIES,
	...ORG_USER_CAPABILITIES,
	...PAGE_TEMPLATE_CAPABILITIES,
	...JINJA_DOCS_CAPABILITIES,
	resultReadCapability,
	...TEMPLATE_LINK_CAPABILITIES,
	...TEMPLATE_SYNC_CAPABILITIES,
	...TEMPLATE_CLONE_CAPABILITIES,
];

const capByName = new Map(ALL_CAPS.map(c => [c.spec.name, c]));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('Unit: capabilityInputSchemas schemaParity', () => {
	for (const [toolName, legacy] of Object.entries(LEGACY_SCHEMAS)) {
		test(`${toolName} derived schema matches legacy`, () => {
			const cap = capByName.get(toolName);
			assert.ok(cap, `${toolName} not found in capability registry`);
			const derived = getSchema(cap);
			assertSchemaParity(toolName, legacy, derived);
			// args must be generated from inputSchema (not hand-written)
			assert.strictEqual(
				cap.spec.args,
				JSON.stringify(cap.spec.inputSchema),
				`${toolName}: args must equal JSON.stringify(inputSchema)`,
			);
		});
	}
});
