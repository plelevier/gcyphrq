import { readdir, readFile, writeFile, mkdir, copyFile, symlink, lstat, stat, rm } from 'fs/promises';
import { join, dirname } from 'path';

/** Check if a file exists (returns false for directories). */
export async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

/** Check if a path is a symlink. */
export async function isSymlink(path: string): Promise<boolean> {
  try {
    const s = await lstat(path);
    return s.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Read a text file. */
export async function readTextFile(path: string): Promise<string> {
  return readFile(path, 'utf-8');
}

/** Write a text file, creating parent directories if needed. */
export async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

/** Create a symlink from `target` → `linkPath`. */
export async function createSymlink(target: string, linkPath: string): Promise<void> {
  await mkdir(dirname(linkPath), { recursive: true });
  await symlink(target, linkPath, 'dir');
}

/** Recursively copy a directory. */
export async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await mkdir(dirname(destPath), { recursive: true });
      await copyFile(srcPath, destPath);
    }
  }
}

/** Remove a path recursively (force: ignore if not found). */
export async function removePath(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Ignore — path may not exist
  }
}
