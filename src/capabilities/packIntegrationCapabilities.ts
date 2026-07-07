import { z } from 'zod';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability } from './capabilityFactories';
import {
	ORG_ID_FIELD,
	optionalClampedInt,
	parseCapabilityInput,
	rawGraphqlOrThrow,
	requiredStringField,
	toInputSchema,
} from './inputHelpers';

const MAX_INTEGRATIONS_LIMIT = 200;

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

const listInstalledPacksInputSchema = z.object({
	orgId: ORG_ID_FIELD,
});

const getPackAuthStatusInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	packName: requiredStringField('packName').describe('A pack ref, e.g. microsoft_graph'),
});

const listPackConfigsInputSchema = z.object({
	orgId: ORG_ID_FIELD,
});

const listIntegrationsInputSchema = z.object({
	orgId: ORG_ID_FIELD,
	limit: optionalClampedInt(MAX_INTEGRATIONS_LIMIT).describe('Max integrations to return (default 50, max 200).'),
});

const listInstalledPacksSpec: ToolSpecDefinition = {
	name: 'buddy_list_installed_packs',
	description:
		'List the integration packs and bundles installed in one Rewst organization (id, name, ref, isBundle, status, packType).',
	inputSchema: toInputSchema(listInstalledPacksInputSchema),
};

const getPackAuthStatusSpec: ToolSpecDefinition = {
	name: 'buddy_get_pack_auth_status',
	description:
		"Check whether a pack needs OAuth setup in one Rewst organization. packName is a pack ref (e.g. microsoft_graph). Returns 'configured' when already authenticated, or the setup URL when authorization is needed.",
	inputSchema: toInputSchema(getPackAuthStatusInputSchema),
};

const listPackConfigsSpec: ToolSpecDefinition = {
	name: 'buddy_list_pack_configs',
	description:
		'List the pack (integration) configurations for one Rewst organization (id, name, packId, default). Returns all configs (this field has no pagination).',
	inputSchema: toInputSchema(listPackConfigsInputSchema),
};

const listIntegrationsSpec: ToolSpecDefinition = {
	name: 'buddy_list_integrations',
	description:
		'List integrations available on the Rewst platform (name, description, numInstalled). Global catalog; the orgId only selects which signed-in session to use.',
	inputSchema: toInputSchema(listIntegrationsInputSchema),
};

async function runListInstalledPacks(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const QUERY = `query RewstBuddyMcpInstalledPacks($orgId: ID!) {
  packsAndBundlesByInstalledState(orgId: $orgId) {
    installedPacksAndBundles {
      id
      name
      ref
      isBundle
      status
      packType
    }
  }
}`;
	const { orgId } = parseCapabilityInput(listInstalledPacksInputSchema, input);
	const variables = { orgId };
	const data = await rawGraphqlOrThrow(ctx.session, QUERY, variables);
	const installedPacksAndBundles = ((
		data as
			| {
					packsAndBundlesByInstalledState?: { installedPacksAndBundles?: unknown[] | null } | null;
			  }
			| undefined
	)?.packsAndBundlesByInstalledState?.installedPacksAndBundles ?? []) as {
		id?: string | null;
		name?: string | null;
		ref?: string | null;
		isBundle?: boolean | null;
		status?: string | null;
		packType?: string | null;
	}[];
	return installedPacksAndBundles
		.map(pack => {
			const name = optionalString(pack.name) ?? '(unnamed)';
			const refOrId = optionalString(pack.ref) ?? optionalString(pack.id) ?? 'unknown';
			const status = optionalString(pack.status);
			return `${name} (${refOrId})${pack.isBundle ? ' [bundle]' : ''}${status ? ' — ' + status : ''}`;
		})
		.join('\n');
}

async function runGetPackAuthStatus(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const QUERY = `query RewstBuddyMcpPackAuthUrl($orgId: ID!, $packName: String!) {
  packAuthUrl(packName: $packName, orgId: $orgId)
}`;
	const { orgId, packName } = parseCapabilityInput(getPackAuthStatusInputSchema, input);
	const variables = { orgId, packName };
	const data = await rawGraphqlOrThrow(ctx.session, QUERY, variables);
	const url = (data as { packAuthUrl?: unknown } | undefined)?.packAuthUrl;
	if (url == null) return 'configured (no auth URL needed)';
	return `needs setup: ${url}`;
}

async function runListPackConfigs(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const QUERY = `query RewstBuddyMcpPackConfigs($orgId: ID!) {
  packConfigs(where: { orgId: $orgId }) {
    id
    name
    packId
    default
    createdAt
  }
}`;
	const { orgId } = parseCapabilityInput(listPackConfigsInputSchema, input);
	const variables = { orgId };
	const data = await rawGraphqlOrThrow(ctx.session, QUERY, variables);
	const packConfigs = ((data as { packConfigs?: unknown[] | null } | undefined)?.packConfigs ?? []) as {
		id?: string | null;
		name?: string | null;
		packId?: string | null;
		default?: boolean | null;
		createdAt?: string | null;
	}[];
	return packConfigs
		.map(config => {
			const name = optionalString(config.name) ?? '(unnamed)';
			const id = optionalString(config.id) ?? 'unknown';
			const packId = optionalString(config.packId) ?? 'unknown';
			return `${name} (${id}) — pack ${packId}${config['default'] ? ' [default]' : ''}`;
		})
		.join('\n');
}

async function runListIntegrations(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const QUERY = `query RewstBuddyMcpIntegrations($limit: Int) {
  integrations(limit: $limit) {
    name
    description
    numInstalled
    isPublic
  }
}`;
	const { limit: rawLimit } = parseCapabilityInput(listIntegrationsInputSchema, input);
	const limit = rawLimit ?? 50;
	const variables = { limit };
	const data = await rawGraphqlOrThrow(ctx.session, QUERY, variables);
	const integrations = ((data as { integrations?: unknown[] | null } | undefined)?.integrations ?? []) as {
		name?: string | null;
		description?: string | null;
		numInstalled?: number | null;
		isPublic?: boolean | null;
	}[];
	return integrations
		.map(integration => {
			const name = optionalString(integration.name) ?? '(unnamed)';
			const description = optionalString(integration.description);
			return `${name}${integration.numInstalled != null ? ' (' + integration.numInstalled + ' installed)' : ''}${
				description ? ' — ' + description : ''
			}`;
		})
		.join('\n');
}

export const PACK_INTEGRATION_CAPABILITIES: Capability[] = [
	readCapability(listInstalledPacksSpec, runListInstalledPacks),
	readCapability(getPackAuthStatusSpec, runGetPackAuthStatus),
	readCapability(listPackConfigsSpec, runListPackConfigs),
	readCapability(listIntegrationsSpec, runListIntegrations),
];
