import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, readFile, symlink, readlink, lstat } from 'fs/promises';
import { join } from 'path';
import { resolveSkillSource, detectAgents, ensureRefFile, installSkill } from '../src/install';
import { copyDir, removePath, fileExists } from '../src/install/fs-utils';

const tmpDir = join(process.cwd(), 'node_modules', '.install-test');

async function setup(): Promise<string> {
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

async function cleanup(): Promise<void> {
  await rm(tmpDir, { recursive: true, force: true });
}

describe('install/fs-utils', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await cleanup(); });

  it('fileExists returns true for existing files', async () => {
    const f = join(tmpDir, 'test.txt');
    await writeFile(f, 'hello');
    expect(await fileExists(f)).toBe(true);
  });

  it('fileExists returns false for missing files', async () => {
    expect(await fileExists(join(tmpDir, 'missing.txt'))).toBe(false);
  });

  it('fileExists returns false for directories', async () => {
    const d = join(tmpDir, 'subdir');
    await mkdir(d, { recursive: true });
    expect(await fileExists(d)).toBe(false);
  });

  it('copyDir recursively copies a directory', async () => {
    const src = join(tmpDir, 'src');
    const dest = join(tmpDir, 'dest');
    await mkdir(join(src, 'sub'), { recursive: true });
    await writeFile(join(src, 'a.txt'), 'content a');
    await writeFile(join(src, 'sub', 'b.txt'), 'content b');

    await copyDir(src, dest);

    expect(await fileExists(join(dest, 'a.txt'))).toBe(true);
    expect(await fileExists(join(dest, 'sub', 'b.txt'))).toBe(true);
    expect(await readFile(join(dest, 'a.txt'), 'utf-8')).toBe('content a');
    expect(await readFile(join(dest, 'sub', 'b.txt'), 'utf-8')).toBe('content b');
  });

  it('removePath removes a directory recursively', async () => {
    const d = join(tmpDir, 'to-remove');
    await mkdir(join(d, 'sub'), { recursive: true });
    await writeFile(join(d, 'file.txt'), 'data');
    expect(await fileExists(join(d, 'file.txt'))).toBe(true);

    await removePath(d);
    expect(await fileExists(join(d, 'file.txt'))).toBe(false);
  });

  it('removePath ignores non-existent paths', async () => {
    // Should not throw
    await expect(removePath(join(tmpDir, 'does-not-exist'))).resolves.not.toThrow();
  });
});

describe('install/ensureRefFile', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await cleanup(); });

  it('creates AGENTS.md with skill entry for opencode', async () => {
    const dir = join(tmpDir, 'project');
    await mkdir(dir, { recursive: true });
    await ensureRefFile('opencode', 'AGENTS.md', dir, 'skills/gcyphrq');

    const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('**gcyphrq**');
    expect(content).toContain('skills/gcyphrq/SKILL.md');
  });

  it('creates CLAUDE.md with skill entry for claude', async () => {
    const dir = join(tmpDir, 'project');
    await mkdir(dir, { recursive: true });
    await ensureRefFile('claude', 'CLAUDE.md', dir, 'skills/gcyphrq');

    const content = await readFile(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('**gcyphrq**');
    expect(content).toContain('skills/gcyphrq/SKILL.md');
  });

  it('appends to existing AGENTS.md', async () => {
    const dir = join(tmpDir, 'project');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'AGENTS.md'), '# Existing content\n');

    await ensureRefFile('opencode', 'AGENTS.md', dir, 'skills/gcyphrq');

    const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('# Existing content');
    expect(content).toContain('**gcyphrq**');
  });

  it('does not duplicate entry if already present', async () => {
    const dir = join(tmpDir, 'project');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'AGENTS.md'), '- **gcyphrq** (`skills/SKILL.md`) - existing\n');

    await ensureRefFile('opencode', 'AGENTS.md', dir, 'skills/gcyphrq');

    const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
    // Should still have only one gcyphrq entry
    const matches = content.match(/\*\*gcyphrq\*\*/g);
    expect(matches).toHaveLength(1);
  });
});

describe('install/resolveSkillSource', () => {
  it('resolves the skill source from the project', () => {
    const source = resolveSkillSource();
    expect(source).toContain('skills');
    expect(source).toContain('gcyphrq');
  });
});

describe('install/detectAgents', () => {
  it('detects installed agents', async () => {
    const agents = await detectAgents();
    // At least pi should be detected on this system
    const names = agents.map(a => a.name);
    expect(names.some(n => ['pi', 'opencode', 'claude'].includes(n))).toBe(true);
  });
});

describe('install/installSkill', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await cleanup(); });

  it('installs skill locally by copying files', async () => {
    const skillSource = resolveSkillSource();
    const projectRoot = join(tmpDir, 'project');
    await mkdir(projectRoot, { recursive: true });

    const agent = {
      name: 'pi',
      globalSkillDir: '',
      globalRefDir: '',
      localSkillDir: join('.pi', 'skills', 'gcyphrq'),
      needsRefFile: false,
    };

    const result = await installSkill(agent, skillSource, 'local', projectRoot);
    expect(result.success).toBe(true);

    const skillMd = join(projectRoot, '.pi', 'skills', 'gcyphrq', 'SKILL.md');
    expect(await fileExists(skillMd)).toBe(true);
    // Should be a copy, not a symlink
    const s = await lstat(skillMd);
    expect(s.isSymbolicLink()).toBe(false);
  });

  it('installs skill globally by creating symlink', async () => {
    const skillSource = resolveSkillSource();
    const globalDir = join(tmpDir, 'global', 'skills', 'gcyphrq');

    const agent = {
      name: 'pi',
      globalSkillDir: globalDir,
      globalRefDir: join(tmpDir, 'global'),
      localSkillDir: '',
      needsRefFile: false,
    };

    const result = await installSkill(agent, skillSource, 'global', tmpDir);
    expect(result.success).toBe(true);

    // Should be a symlink
    const s = await lstat(globalDir);
    expect(s.isSymbolicLink()).toBe(true);

    // Symlink should point to skill source
    const target = await readlink(globalDir);
    expect(target).toBe(skillSource);
  });

  it('reports already installed for existing symlink', async () => {
    const skillSource = resolveSkillSource();
    const globalDir = join(tmpDir, 'global', 'skills', 'gcyphrq');
    await mkdir(join(tmpDir, 'global', 'skills'), { recursive: true });
    await symlink(skillSource, globalDir, 'dir');

    const agent = {
      name: 'pi',
      globalSkillDir: globalDir,
      globalRefDir: join(tmpDir, 'global'),
      localSkillDir: '',
      needsRefFile: false,
    };

    const result = await installSkill(agent, skillSource, 'global', tmpDir);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Already installed');
  });

  it('creates AGENTS.md for opencode on local install', async () => {
    const skillSource = resolveSkillSource();
    const projectRoot = join(tmpDir, 'project');
    await mkdir(projectRoot, { recursive: true });

    const agent = {
      name: 'opencode',
      globalSkillDir: '',
      globalRefDir: '',
      localSkillDir: join('.opencode', 'skills', 'gcyphrq'),
      needsRefFile: true,
      refFileName: 'AGENTS.md',
    };

    const result = await installSkill(agent, skillSource, 'local', projectRoot);
    expect(result.success).toBe(true);

    const agentsMd = join(projectRoot, 'AGENTS.md');
    expect(await fileExists(agentsMd)).toBe(true);
    const content = await readFile(agentsMd, 'utf-8');
    expect(content).toContain('**gcyphrq**');
  });
});
