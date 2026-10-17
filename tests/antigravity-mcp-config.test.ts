import { describe, it, expect } from 'bun:test';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { resolveAntigravityMcpConfigPath } from '../src/services/integrations/McpIntegrations';

const CENTRAL = join(homedir(), '.gemini', 'config', 'mcp_config.json');
const LEGACY = join(homedir(), '.gemini', 'antigravity', 'mcp_config.json');

describe('antigravity mcp config path', () => {
  it('resolves to the central path unless only the legacy file exists', () => {
    const resolved = resolveAntigravityMcpConfigPath();

    if (!existsSync(CENTRAL) && existsSync(LEGACY)) {
      expect(resolved).toBe(LEGACY);
    } else {
      expect(resolved).toBe(CENTRAL);
    }
  });

  it('never points at the pre-2.0 antigravity directory when the central file exists', () => {
    if (!existsSync(CENTRAL)) return;
    expect(resolveAntigravityMcpConfigPath()).not.toBe(LEGACY);
  });
});
