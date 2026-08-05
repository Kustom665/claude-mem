import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';

const SKILLS_DIR = join(import.meta.dir, '../../plugin/skills');

/**
 * The five memory-leverage skills. Each turns claude-mem's archive into a
 * different kind of agent fan-out; three bundle a script that does the counting
 * so the agents only spend tokens on judgment.
 */
interface SkillSpec {
  name: string;
  /** Bundled script, or null for the two skills that need no script. */
  script: string | null;
  commands: string[];
  /** A command that needs the worker and takes no required flags, so the
   *  unreachable-worker path is what actually gets exercised. */
  workerCommand: string | null;
}

const SKILLS: SkillSpec[] = [
  { name: 'scar-tissue', script: 'scars.mjs', commands: ['changed', 'history', 'map'], workerCommand: 'map' },
  { name: 'decision-decay', script: null, commands: [], workerCommand: null },
  { name: 'prompt-forensics', script: 'forensics.mjs', commands: ['sessions', 'prompts'], workerCommand: 'sessions' },
  { name: 'cross-pollinate', script: null, commands: [], workerCommand: null },
  { name: 'truth-decay', script: 'rot.mjs', commands: ['scan', 'files'], workerCommand: 'scan' },
];

function frontmatter(content: string): string {
  expect(content.startsWith('---\n')).toBe(true);
  const end = content.indexOf('\n---\n', 4);
  expect(end).toBeGreaterThan(0);
  return content.slice(4, end);
}

describe('agent-leverage skills', () => {
  for (const skill of SKILLS) {
    describe(skill.name, () => {
      const skillPath = join(SKILLS_DIR, skill.name, 'SKILL.md');

      it('ships a SKILL.md', () => {
        expect(existsSync(skillPath)).toBe(true);
      });

      it('declares a name matching its directory, plus a description', () => {
        const fm = frontmatter(readFileSync(skillPath, 'utf-8'));
        expect(fm).toContain(`name: ${skill.name}`);
        expect(fm).toContain('description:');
      });

      it('describes a subagent fan-out with a reporting contract', () => {
        const content = readFileSync(skillPath, 'utf-8');
        // Every one of these skills is an orchestrator: it dispatches agents and
        // refuses their reports when the evidence is missing.
        expect(content).toContain('Agent brief');
        expect(content).toContain('Failure Modes');
      });

      if (skill.script) {
        const scriptPath = join(SKILLS_DIR, skill.name, skill.script);

        it('bundles its script', () => {
          expect(existsSync(scriptPath)).toBe(true);
        });

        it('SKILL.md invokes the bundled script via CLAUDE_SKILL_DIR', () => {
          const content = readFileSync(skillPath, 'utf-8');
          expect(content).toContain(`\${CLAUDE_SKILL_DIR}/${skill.script}`);
        });

        it('script parses as an ES module', () => {
          const result = spawnSync('node', ['--check', scriptPath], { encoding: 'utf-8' });
          expect(result.stderr ?? '').toBe('');
          expect(result.status).toBe(0);
        });

        it('--help exits zero and lists every documented command', () => {
          const result = spawnSync('node', [scriptPath, '--help'], { encoding: 'utf-8' });
          expect(result.status).toBe(0);
          for (const command of skill.commands) {
            expect(result.stdout).toContain(command);
          }
        });

        it('fails cleanly when the worker is unreachable', () => {
          // Port 1 is never a live claude-mem worker. The script must say so and
          // exit non-zero rather than throwing a fetch stack at the agent.
          const result = spawnSync('node', [scriptPath, skill.workerCommand!], {
            encoding: 'utf-8',
            env: { ...process.env, CLAUDE_MEM_WORKER_PORT: '1' },
          });
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain('worker unreachable');
        });
      }
    });
  }
});
