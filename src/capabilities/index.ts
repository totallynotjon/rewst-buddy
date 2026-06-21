export type { Capability, CapabilityAccess, CapabilityContext } from './Capability';
export {
	CAPABILITY_REGISTRY,
	chatCapabilities,
	enabledMcpCapabilities,
	getCapability,
	mcpCapabilities,
} from './registry';
export {
	_resetMcpMutationApproverForTesting,
	graphqlMutateCapability,
	setMcpMutationApprover,
	type McpMutationApprover,
} from './graphqlMutateCapability';
