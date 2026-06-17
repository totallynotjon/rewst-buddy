#!/usr/bin/env node
import { runBridge } from '../bridge';

/**
 * CLI entry point for the credential-free stdio MCP bridge. External MCP clients
 * spawn this with `node dist/mcp/rewst-mcp.js`. All logic lives in ../bridge so
 * it can be unit-tested without starting a stdio server on import.
 */
runBridge().catch(error => {
	process.stderr.write(`rewst-mcp bridge failed to start: ${error instanceof Error ? error.message : error}\n`);
	process.exit(1);
});
