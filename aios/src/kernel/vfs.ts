import { ENOENT, EISDIR, ENOTDIR, EACCES } from './errors.ts';
import type { VNode } from './types.ts';

/**
 * A virtual filesystem: an in-memory tree that can be snapshotted to disk.
 *
 * Synthetic mounts (used for /proc) generate their contents at read time from a
 * provider function, so `cat /proc/3/status` always reflects live kernel state
 * rather than a stale copy.
 */
export class VFS {
  private root: VNode = makeDir('/');

  /** mountPoint -> provider. Keys are absolute, normalized, no trailing slash. */
  private synthetic = new Map<string, SyntheticProvider>();

  constructor() {
    for (const dir of ['/bin', '/home', '/tmp', '/etc', '/var', '/var/log', '/proc']) {
      this.mkdirp(dir);
    }
  }

  /**
   * Mount a synthetic tree. The provider is asked to list a directory or read a
   * file for any path at or below `mountPoint`.
   */
  mountSynthetic(mountPoint: string, provider: SyntheticProvider): void {
    this.synthetic.set(normalize(mountPoint), provider);
  }

  /** Normalize a possibly-relative path against `cwd`. */
  resolve(path: string, cwd = '/'): string {
    return normalize(path.startsWith('/') ? path : `${cwd}/${path}`);
  }

  /** Find the synthetic provider owning `path`, if any. */
  private syntheticFor(path: string): { mount: string; provider: SyntheticProvider } | null {
    for (const [mount, provider] of this.synthetic) {
      if (path === mount || path.startsWith(`${mount}/`)) return { mount, provider };
    }
    return null;
  }

  exists(path: string): boolean {
    const p = normalize(path);
    const syn = this.syntheticFor(p);
    if (syn) return syn.provider.exists(relativeTo(syn.mount, p));
    return this.lookup(p) !== null;
  }

  isDir(path: string): boolean {
    const p = normalize(path);
    const syn = this.syntheticFor(p);
    if (syn) return syn.provider.isDir(relativeTo(syn.mount, p));
    return this.lookup(p)?.type === 'dir';
  }

  read(path: string): string {
    const p = normalize(path);
    const syn = this.syntheticFor(p);
    if (syn) {
      const rel = relativeTo(syn.mount, p);
      if (!syn.provider.exists(rel)) throw new ENOENT(p);
      if (syn.provider.isDir(rel)) throw new EISDIR(p);
      return syn.provider.read(rel);
    }
    const node = this.lookup(p);
    if (!node) throw new ENOENT(p);
    if (node.type === 'dir') throw new EISDIR(p);
    return node.content;
  }

  write(path: string, content: string, append = false): void {
    const p = normalize(path);
    if (this.syntheticFor(p)) throw new EACCES(p);

    const { dir, base } = split(p);
    const parent = this.lookup(dir);
    if (!parent) throw new ENOENT(dir);
    if (parent.type !== 'dir') throw new ENOTDIR(dir);

    const existing = parent.children.get(base);
    if (existing) {
      if (existing.type === 'dir') throw new EISDIR(p);
      existing.content = append ? existing.content + content : content;
      existing.modifiedAt = Date.now();
      return;
    }
    parent.children.set(base, makeFile(base, content));
  }

  mkdir(path: string): void {
    const p = normalize(path);
    if (this.syntheticFor(p)) throw new EACCES(p);

    const { dir, base } = split(p);
    const parent = this.lookup(dir);
    if (!parent) throw new ENOENT(dir);
    if (parent.type !== 'dir') throw new ENOTDIR(dir);
    // mkdir on an existing directory is a no-op, which keeps mkdirp simple.
    if (parent.children.has(base)) return;
    parent.children.set(base, makeDir(base));
  }

  /** mkdir -p: create every missing component. */
  mkdirp(path: string): void {
    const parts = normalize(path).split('/').filter(Boolean);
    let cur = '';
    for (const part of parts) {
      cur += `/${part}`;
      if (!this.exists(cur)) this.mkdir(cur);
    }
  }

  unlink(path: string): void {
    const p = normalize(path);
    if (p === '/') throw new EACCES(p);
    if (this.syntheticFor(p)) throw new EACCES(p);

    const { dir, base } = split(p);
    const parent = this.lookup(dir);
    if (!parent || !parent.children.has(base)) throw new ENOENT(p);
    parent.children.delete(base);
  }

  list(path: string): string[] {
    const p = normalize(path);
    const syn = this.syntheticFor(p);
    if (syn) {
      const rel = relativeTo(syn.mount, p);
      if (!syn.provider.exists(rel)) throw new ENOENT(p);
      return syn.provider.list(rel);
    }
    const node = this.lookup(p);
    if (!node) throw new ENOENT(p);
    if (node.type !== 'dir') throw new ENOTDIR(p);
    return [...node.children.keys()].sort();
  }

  stat(path: string): { type: 'file' | 'dir'; size: number; modifiedAt: number } {
    const p = normalize(path);
    const syn = this.syntheticFor(p);
    if (syn) {
      const rel = relativeTo(syn.mount, p);
      if (!syn.provider.exists(rel)) throw new ENOENT(p);
      const isDir = syn.provider.isDir(rel);
      return {
        type: isDir ? 'dir' : 'file',
        size: isDir ? 0 : syn.provider.read(rel).length,
        modifiedAt: Date.now(),
      };
    }
    const node = this.lookup(p);
    if (!node) throw new ENOENT(p);
    return {
      type: node.type,
      size: node.type === 'file' ? node.content.length : node.children.size,
      modifiedAt: node.modifiedAt,
    };
  }

  private lookup(path: string): VNode | null {
    const parts = normalize(path).split('/').filter(Boolean);
    let node = this.root;
    for (const part of parts) {
      if (node.type !== 'dir') return null;
      const next = node.children.get(part);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  /** Serialize the real (non-synthetic) tree so a session can be restored. */
  snapshot(): string {
    return JSON.stringify(serialize(this.root), null, 2);
  }

  /** Restore a tree produced by {@link snapshot}. */
  restore(json: string): void {
    this.root = deserialize(JSON.parse(json));
  }
}

/** Backs a synthetic mount such as /proc. Paths are relative to the mount. */
export interface SyntheticProvider {
  exists(relPath: string): boolean;
  isDir(relPath: string): boolean;
  read(relPath: string): string;
  list(relPath: string): string[];
}

function makeDir(name: string): VNode {
  const now = Date.now();
  return { name, type: 'dir', content: '', children: new Map(), createdAt: now, modifiedAt: now };
}

function makeFile(name: string, content: string): VNode {
  const now = Date.now();
  return { name, type: 'file', content, children: new Map(), createdAt: now, modifiedAt: now };
}

/** Collapse `.`/`..`, duplicate slashes, and any trailing slash. */
export function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

/** Split into parent directory and basename. */
export function split(path: string): { dir: string; base: string } {
  const p = normalize(path);
  const idx = p.lastIndexOf('/');
  return { dir: idx === 0 ? '/' : p.slice(0, idx), base: p.slice(idx + 1) };
}

/** Path relative to a mount point, without a leading slash. */
function relativeTo(mount: string, path: string): string {
  return path === mount ? '' : path.slice(mount.length + 1);
}

interface SerializedNode {
  name: string;
  type: 'file' | 'dir';
  content: string;
  children: SerializedNode[];
}

function serialize(node: VNode): SerializedNode {
  return {
    name: node.name,
    type: node.type,
    content: node.content,
    children: [...node.children.values()].map(serialize),
  };
}

function deserialize(data: SerializedNode): VNode {
  const now = Date.now();
  const node: VNode = {
    name: data.name,
    type: data.type,
    content: data.content,
    children: new Map(),
    createdAt: now,
    modifiedAt: now,
  };
  for (const child of data.children) node.children.set(child.name, deserialize(child));
  return node;
}
