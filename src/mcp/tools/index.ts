import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSessionTools } from './sessionTools';
import { registerTemplateTools } from './templateTools';
import { registerUserTools } from './userTools';
import { registerGraphqlTools } from './graphqlTools';
import { registerOrganizationTools } from './organizationTools';
import { registerWorkflowTools } from './workflowTools';
import { registerWorkflowExecutionTools } from './workflowExecutionTools';

export function registerAllTools(server: McpServer): void {
	registerSessionTools(server);
	registerTemplateTools(server);
	registerUserTools(server);
	registerGraphqlTools(server);
	registerOrganizationTools(server);
	registerWorkflowTools(server);
	registerWorkflowExecutionTools(server);
}

export { resolveSession } from './resolveSession';
export { clearIntrospectionCache } from './graphqlTools';
