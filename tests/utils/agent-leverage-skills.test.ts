import { describe, it, expect, afterAll } from 'bun:test';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
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
   *  unreachable-worker path is what actually gets exercised. Null when the
   *  skill has no script, or when every command tolerates a dead worker
   *  (flywheel keeps local state either way — that is the point of it). */
  workerCommand: string | null;
  /** Dispatches subagents itself. flywheel sequences skills, not agents. */
  dispatchesAgents: boolean;
}

const SKILLS: SkillSpec[] = [
  { name: 'scar-tissue', script: 'scars.mjs', commands: ['changed', 'history', 'map'], workerCommand: 'map', dispatchesAgents: true },
  { name: 'decision-decay', script: null, commands: [], workerCommand: null, dispatchesAgents: true },
  { name: 'prompt-forensics', script: 'forensics.mjs', commands: ['sessions', 'prompts'], workerCommand: 'sessions', dispatchesAgents: true },
  { name: 'cross-pollinate', script: null, commands: [], workerCommand: null, dispatchesAgents: true },
  { name: 'truth-decay', script: 'rot.mjs', commands: ['scan', 'files'], workerCommand: 'scan', dispatchesAgents: true },
  { name: 'flywheel', script: 'wheel.mjs', commands: ['state', 'due', 'record', 'recall', 'complete'], workerCommand: null, dispatchesAgents: false },
];

/** Stages the pipeline sequences, in the order flywheel documents. */
const PIPELINE_ORDER = ['truth-decay', 'decision-decay', 'cross-pollinate', 'prompt-forensics'];

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

      it('documents its failure modes', () => {
        expect(readFileSync(skillPath, 'utf-8')).toContain('Failure Modes');
      });

      if (skill.dispatchesAgents) {
        it('describes a subagent fan-out with a reporting contract', () => {
          // These skills are orchestrators: they dispatch agents and refuse
          // reports that arrive without evidence.
          expect(readFileSync(skillPath, 'utf-8')).toContain('Agent brief');
        });

        it('records findings through the wheel, not the server-beta-only MCP tools', () => {
          const content = readFileSync(skillPath, 'utf-8');
          // memory_add / observation_add throw unless the server-beta runtime is
          // active, so a default SQLite install cannot use them to write back.
          // Any mention must sit inside a warning, never read as an instruction.
          // Scan a window around each mention: the warning often wraps lines.
          for (let at = content.indexOf('`memory_add`'); at !== -1; at = content.indexOf('`memory_add`', at + 1)) {
            const window = content.slice(Math.max(0, at - 200), at + 200);
            expect(window).toMatch(/Do not use|rather than|require the server-beta runtime/);
          }
          expect(content).toContain('flywheel/wheel.mjs');
        });

        it('the sibling wheel path it invokes actually resolves', () => {
          const content = readFileSync(skillPath, 'utf-8');
          const referencesSibling = content.includes('${CLAUDE_SKILL_DIR}/../flywheel/wheel.mjs');
          expect(referencesSibling).toBe(true);
          expect(existsSync(join(SKILLS_DIR, skill.name, '..', 'flywheel', 'wheel.mjs'))).toBe(true);
        });
      }

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

        if (skill.workerCommand) {
          it('fails cleanly when the worker is unreachable', () => {
            // Port 1 is never a live claude-mem worker. The script must say so
            // and exit non-zero rather than throwing a fetch stack at the agent.
            const result = spawnSync('node', [scriptPath, skill.workerCommand!], {
              encoding: 'utf-8',
              env: { ...process.env, CLAUDE_MEM_WORKER_PORT: '1' },
            });
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain('worker unreachable');
          });
        }
      }
    });
  }

  /**
   * Two verdicts write to something expensive: scar-tissue's REOPENS blocks a
   * commit, truth-decay's FALSE writes a correction future sessions read as
   * fact. Both go through a refutation panel; the cheap verdicts deliberately
   * do not, because panelling everything just triples the cost of the common
   * path.
   */
  describe('adversarial verification', () => {
    const PANELLED = [
      { skill: 'scar-tissue', verdict: 'REOPENS', lenses: ['Bug', 'Diff', 'Codebase'] },
      { skill: 'truth-decay', verdict: 'FALSE', lenses: ['Claim', 'Relocation', 'Environment'] },
    ];

    for (const { skill, verdict, lenses } of PANELLED) {
      const content = () => readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf-8');

      it(`${skill} panels its ${verdict} verdict`, () => {
        expect(content()).toContain('Refuter brief');
        expect(content()).toMatch(/refute/i);
      });

      it(`${skill} gives each refuter a distinct lens`, () => {
        // Three clones make the same mistake and return a unanimous wrong
        // answer that then looks verified. Diversity is the mechanism.
        for (const lens of lenses) expect(content()).toContain(`**${lens}**`);
      });

      it(`${skill} treats can't-establish as refuted`, () => {
        // The tie-break has to fall toward not acting, in both skills: an
        // unproven blocker shouldn't block, an unproven FALSE shouldn't write.
        expect(content()).toContain('return `refuted: true`');
      });

      it(`${skill} kills the verdict on a majority`, () => {
        expect(content()).toContain('Two of three refute');
      });
    }

    it('scar-tissue does not panel the cheap verdicts', () => {
      const content = readFileSync(join(SKILLS_DIR, 'scar-tissue/SKILL.md'), 'utf-8');
      expect(content).toContain('**Panel only the `REOPENS` verdicts.**');
    });

    it('scar-tissue names the false-CLEAR asymmetry rather than hiding it', () => {
      // A missed regression gets no panel. That limit is stated on purpose.
      const content = readFileSync(join(SKILLS_DIR, 'scar-tissue/SKILL.md'), 'utf-8');
      expect(content).toContain('SCARS CONSIDERED');
      expect(content).toMatch(/asymmetry/i);
    });

    it('truth-decay verifies MOVED mechanically instead of with agents', () => {
      const content = readFileSync(join(SKILLS_DIR, 'truth-decay/SKILL.md'), 'utf-8');
      expect(content).toContain('test -e');
    });

    it('scar-tissue only records recurrences that survived the panel', () => {
      const content = readFileSync(join(SKILLS_DIR, 'scar-tissue/SKILL.md'), 'utf-8');
      expect(content).toContain('recurrence-confirmed');
      expect(content).toContain('Only record recurrences that survived');
    });
  });

  describe('pipeline ordering', () => {
    it('flywheel documents the stages in dependency order', () => {
      const content = readFileSync(join(SKILLS_DIR, 'flywheel/SKILL.md'), 'utf-8');
      const positions = PIPELINE_ORDER.map(stage => content.indexOf(`\`${stage}\``));
      for (const position of positions) expect(position).toBeGreaterThan(-1);
      // truth-decay must come first: every later stage reads memory, so auditing
      // against un-verified memory would launder stale claims into reports.
      const sorted = [...positions].sort((a, b) => a - b);
      expect(positions).toEqual(sorted);
    });
  });
});

describe('flywheel state machine', () => {
  // The wheel writes under $HOME/.claude-mem — give it a throwaway one so the
  // test never touches a real developer's state.
  const home = mkdtempSync(join(tmpdir(), 'cm-wheel-home-'));
  const wheel = join(SKILLS_DIR, 'flywheel/wheel.mjs');
  const env = { ...process.env, HOME: home, CLAUDE_MEM_WORKER_PORT: '1' };

  const run = (...args: string[]) =>
    spawnSync('node', [wheel, ...args, '--project', 'test-project'], { encoding: 'utf-8', env });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it('starts with every clock-driven stage due and scar-tissue diff-gated', () => {
    const result = run('due', '--json');
    expect(result.status).toBe(0);
    const due = JSON.parse(result.stdout).map((row: { stage: string }) => row.stage);
    expect(due).toContain('truth-decay');
    expect(due).not.toContain('scar-tissue');
  });

  it('keeps the finding locally when the memory write-back fails', () => {
    const result = run('record', '--stage', 'truth-decay', '--kind', 'correction', '--summary', 'stale path', '--refs', '1,2', '--open');
    // Worker is unreachable on port 1, but a lost finding is never acceptable.
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('memory write-back failed');

    const recalled = JSON.parse(run('recall', '--stage', 'truth-decay', '--json').stdout);
    expect(recalled.local).toHaveLength(1);
    expect(recalled.local[0].summary).toBe('stale path');
    expect(recalled.local[0].refs).toEqual(['1', '2']);
    expect(recalled.local[0].memory_id).toBeNull();
  });

  it('clears a stage from due only once it is completed', () => {
    expect(JSON.parse(run('due', '--json').stdout).map((r: { stage: string }) => r.stage)).toContain('truth-decay');
    expect(run('complete', '--stage', 'truth-decay', '--note', 'done').status).toBe(0);
    expect(JSON.parse(run('due', '--json').stdout).map((r: { stage: string }) => r.stage)).not.toContain('truth-decay');
  });

  it('carries open items across runs until they are closed', () => {
    const before = JSON.parse(run('state', '--json').stdout);
    expect(before.stages.find((s: { stage: string }) => s.stage === 'truth-decay').open_items).toBe(1);

    run('complete', '--stage', 'truth-decay', '--close', '1');

    const after = JSON.parse(run('state', '--json').stdout);
    expect(after.stages.find((s: { stage: string }) => s.stage === 'truth-decay').open_items).toBe(0);
  });

  it('rejects an unknown stage rather than silently writing one', () => {
    const result = run('record', '--stage', 'not-a-stage', '--summary', 'x');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unknown stage');
  });
});
