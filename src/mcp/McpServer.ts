import { McpServer as McpServerClass } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from './tools';

export const mcpServer = new McpServerClass({
	name: 'rewst-buddy',
	version: '1.0.0',
});

registerAllTools(mcpServer);
