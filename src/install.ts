import { join, resolve, relative } from 'path';
import { readlinkSync, statSync } from 'fs';
import { stat } from 'fs/promises';
import { fileExists, readTextFile, writeTextFile, createSymlink, copyDir, removePath, isSymlink } from './install/fs-utils';

// ── Agent Definitions ────────────────────────────────────────────────────────

export interface AgentInfo {
  name: string;
  globalSkillDir: string;       // Global skill install dir (under home)
  globalRefDir: string;         // Global dir for AGENTS.md / CLAUDE.md
  localSkillDir: string;        // Local skill install dir (under project)
  needsRefFile: boolean;        // Whether it needs an AGENTS.md / CLAUDE.md entry
  refFileName?: string;         // Name of the reference file
}

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const SKILL_NAME = 'gcyphrq';

interface AgentTemplate {
  name: string;
  detectPaths: string[];        // Paths that indicate the agent is installed (first match is used as base)
  localSkillDir: string;        // Local skill install dir (under project)
  needsRefFile: boolean;        // Whether it needs an AGENTS.md / CLAUDE.md entry
  refFileName?: string;         // Name of the reference file
}

const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    name: 'pi',
    detectPaths: [join(HOME, '.pi', 'agent')],
    localSkillDir: join('.pi', 'skills', SKILL_NAME),
    needsRefFile: false,
  },
  {
    name: 'opencode',
    detectPaths: [join(HOME, '.opencode'), join(HOME, '.config', 'opencode')],
    localSkillDir: join('.opencode', 'skills', SKILL_NAME),
    needsRefFile: true,
    refFileName: 'AGENTS.md',
  },
  {
    name: 'claude',
    detectPaths: [join(HOME, '.claude')],
    localSkillDir: join('.claude', 'skills', SKILL_NAME),
    needsRefFile: true,
    refFileName: 'CLAUDE.md',
  },
];

/**
 * Build AgentInfo with resolved global paths based on the detected config directory.
 * The global skill/ref dirs are derived from whichever detectPath matched.
 */
function buildAgentInfo(template: AgentTemplate, matchedConfigDir: string): AgentInfo {
  return {
    name: template.name,
    globalSkillDir: join(matchedConfigDir, 'skills', SKILL_NAME),
    globalRefDir: matchedConfigDir,
    localSkillDir: template.localSkillDir,
    needsRefFile: template.needsRefFile,
    refFileName: template.refFileName,
  };
}

// ── Skill Source Resolution ──────────────────────────────────────────────────

/**
 * Resolve the path to the bundled skill content.
 * Works both in dev (src/../skills) and in a built/installed package (package root ./skills).
 */
export function resolveSkillSource(): string {
  const candidates = [
    // Installed package: skills/gcyphrq (from bundled CLI in dist/)
    join(import.meta.dirname, '..', 'skills', SKILL_NAME),
    // Dev mode: skills/gcyphrq (from project root via tsx)
    join(import.meta.dirname, '..', '..', 'skills', SKILL_NAME),
  ];

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    const skillMd = join(resolved, 'SKILL.md');
    if (fileExistsSync(skillMd)) {
      return resolved;
    }
  }

  throw new Error(
    `Skill source not found. Expected "skills/gcyphrq/SKILL.md" near the binary.\n` +
    `Searched: ${candidates.join(', ')}`
  );
}

// Sync wrapper for fileExists (used during skill source resolution in non-async context)
function fileExistsSync(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// ── Agent Detection ──────────────────────────────────────────────────────────

/** Detect which agents are installed on this system. */
export async function detectAgents(): Promise<AgentInfo[]> {
  const detected: AgentInfo[] = [];
  for (const template of AGENT_TEMPLATES) {
    for (const p of template.detectPaths) {
      if (await isDir(p)) {
        detected.push(buildAgentInfo(template, p));
        break;
      }
    }
  }
  return detected;
}

async function isDir(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

// ── Reference File Content ───────────────────────────────────────────────────

/** Generate the skill entry text for an AGENTS.md or CLAUDE.md file. */
function getSkillEntry(agentName: string, skillPath: string): string {
  const relPath = skillPath.replace(/\\/g, '/');

  if (agentName === 'opencode') {
    return `- **${SKILL_NAME}** (\`${relPath}/SKILL.md\`) - Cypher graph query tool for service dependencies, infrastructure topology, blast radius analysis`;
  }

  if (agentName === 'claude') {
    return `- **${SKILL_NAME}** (\`${relPath}/SKILL.md\`) - Cypher graph query tool. Use for service dependencies, blast radius, path tracing`;
  }

  return `Skill: ${SKILL_NAME} at ${relPath}`;
}

/**
 * Ensure a reference file (AGENTS.md / CLAUDE.md) contains an entry for the skill.
 * Appends the entry if the file doesn't exist or doesn't contain the skill yet.
 */
export async function ensureRefFile(
  agentName: string,
  refFileName: string,
  refDir: string,
  skillPath: string
): Promise<void> {
  const refPath = join(refDir, refFileName);
  const entry = getSkillEntry(agentName, skillPath);
  const marker = `**${SKILL_NAME}**`;

  let content = '';
  if (await fileExists(refPath)) {
    content = await readTextFile(refPath);
    if (content.includes(marker)) {
      return; // Already present
    }
    // Append with a separator if the file has content
    if (content.trim()) {
      content += '\n\n';
    }
  }

  await writeTextFile(refPath, content + entry + '\n');
}

// ── Installation ─────────────────────────────────────────────────────────────

export interface InstallResult {
  agent: string;
  mode: 'global' | 'local';
  success: boolean;
  message: string;
}

/**
 * Install the skill for a single agent.
 *
 * - Global mode: creates symlinks to the skill source (works for installed packages)
 * - Local mode: copies the skill content into the project directory
 */
export async function installSkill(
  agent: AgentInfo,
  skillSource: string,
  mode: 'global' | 'local',
  projectRoot: string
): Promise<InstallResult> {
  const targetDir = mode === 'global'
    ? agent.globalSkillDir
    : resolve(projectRoot, agent.localSkillDir);

  try {
    let alreadyInstalled = false;
    let existingSymlinkTarget: string | undefined;

    // Check if already installed
    const existingSkillMd = join(targetDir, 'SKILL.md');
    if (await fileExists(existingSkillMd)) {
      // For symlinks, check if it points to a valid location
      if (mode === 'global' && await isSymlink(targetDir)) {
        const currentTarget = readlinkSync(targetDir);
        if (await fileExists(join(currentTarget, 'SKILL.md'))) {
          alreadyInstalled = true;
          existingSymlinkTarget = currentTarget;
        } else {
          // Broken symlink — remove and recreate
          await removePath(targetDir);
        }
      } else {
        // For copies, check if content is identical
        const existingContent = await readTextFile(existingSkillMd);
        const sourceContent = await readTextFile(join(skillSource, 'SKILL.md'));
        if (existingContent === sourceContent) {
          alreadyInstalled = true;
        } else {
          // Stale copy — remove and reinstall
          await removePath(targetDir);
        }
      }
    }

    // Install the skill (if not already installed)
    if (!alreadyInstalled) {
      if (mode === 'global') {
        // Create symlink to the skill source
        await createSymlink(skillSource, targetDir);
      } else {
        // Copy skill content into project
        await copyDir(skillSource, targetDir);
      }
    }

    // Always ensure reference file is up to date
    if (agent.needsRefFile && agent.refFileName) {
      const refFileDir = mode === 'global'
        ? agent.globalRefDir
        : projectRoot;

      const displayPath = mode === 'global'
        ? targetDir
        : relative(refFileDir, targetDir);

      await ensureRefFile(agent.name, agent.refFileName, refFileDir, displayPath);
    }

    return {
      agent: agent.name,
      mode,
      success: true,
      message: alreadyInstalled
        ? (existingSymlinkTarget
            ? `Already installed (${existingSymlinkTarget})`
            : 'Already up to date')
        : (mode === 'global'
            ? `Installed → ${targetDir}`
            : `Installed → ${relative(process.cwd(), targetDir)}`),
    };
  } catch (err: unknown) {
    return {
      agent: agent.name,
      mode,
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Public Entry Point ───────────────────────────────────────────────────────

/**
 * Run the install command. Detects installed agents and installs the skill.
 *
 * @param mode - 'global' (symlinks) or 'local' (copies into project)
 * @param projectRoot - Current working directory (for local installs)
 */
export async function runInstall(mode: 'global' | 'local', projectRoot: string): Promise<void> {
  const skillSource = resolveSkillSource();
  const agents = await detectAgents();

  if (!agents.length) {
    console.error('No supported agents detected (pi, opencode, claude).');
    console.error('Nothing to install.');
    process.exit(1);
  }

  const modeLabel = mode === 'global' ? 'global (symlinks)' : 'local (copies)';
  console.log(`Installing gcyphrq skill (${modeLabel})...`);
  console.log(`Skill source: ${skillSource}`);
  console.log('');

  const results: InstallResult[] = [];
  for (const agent of agents) {
    console.log(`Detecting ${agent.name}...`);
    const result = await installSkill(agent, skillSource, mode, projectRoot);
    results.push(result);

    if (result.success) {
      console.log(`  ✓ ${agent.name}: ${result.message}`);
    } else {
      console.error(`  ✗ ${agent.name}: ${result.message}`);
    }
  }

  console.log('');
  const failures = results.filter(r => !r.success);
  if (failures.length) {
    console.error(`Failed to install for: ${failures.map(f => f.agent).join(', ')}`);
    process.exit(1);
  } else {
    console.log(`Successfully installed gcyphrq skill for: ${results.map(r => r.agent).join(', ')}`);
  }
}
