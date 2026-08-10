import { describe, expect, test } from 'bun:test';
import { VFS, normalize, split } from '../src/kernel/vfs.ts';
import { MemoryStore } from '../src/kernel/memory.ts';

describe('path handling', () => {
  test('normalize collapses . .. and redundant slashes', () => {
    expect(normalize('/a/b/../c')).toBe('/a/c');
    expect(normalize('/a//b/./c/')).toBe('/a/b/c');
    expect(normalize('/')).toBe('/');
    expect(normalize('/a/b/../..')).toBe('/');
    // `..` past the root stays at the root rather than escaping it.
    expect(normalize('/../../etc')).toBe('/etc');
  });

  test('split separates parent and basename', () => {
    expect(split('/a/b/c.txt')).toEqual({ dir: '/a/b', base: 'c.txt' });
    expect(split('/top')).toEqual({ dir: '/', base: 'top' });
  });

  test('resolve applies the working directory to relative paths', () => {
    const vfs = new VFS();
    expect(vfs.resolve('notes.txt', '/home')).toBe('/home/notes.txt');
    expect(vfs.resolve('../etc/motd', '/home/work')).toBe('/home/etc/motd');
    expect(vfs.resolve('/absolute', '/home')).toBe('/absolute');
  });
});

describe('files and directories', () => {
  test('write then read round-trips', () => {
    const vfs = new VFS();
    vfs.write('/tmp/a.txt', 'hello');
    expect(vfs.read('/tmp/a.txt')).toBe('hello');
  });

  test('append adds to existing content', () => {
    const vfs = new VFS();
    vfs.write('/tmp/a.txt', 'one');
    vfs.write('/tmp/a.txt', '-two', true);
    expect(vfs.read('/tmp/a.txt')).toBe('one-two');
  });

  test('mkdirp creates every missing parent', () => {
    const vfs = new VFS();
    vfs.mkdirp('/a/b/c/d');
    expect(vfs.isDir('/a/b/c/d')).toBe(true);
    expect(vfs.isDir('/a/b')).toBe(true);
  });

  test('listing is sorted', () => {
    const vfs = new VFS();
    vfs.write('/tmp/c', '');
    vfs.write('/tmp/a', '');
    vfs.write('/tmp/b', '');
    expect(vfs.list('/tmp')).toEqual(['a', 'b', 'c']);
  });

  test('unlink removes an entry', () => {
    const vfs = new VFS();
    vfs.write('/tmp/gone.txt', 'x');
    vfs.unlink('/tmp/gone.txt');
    expect(vfs.exists('/tmp/gone.txt')).toBe(false);
  });

  test('errors are specific and typed', () => {
    const vfs = new VFS();
    expect(() => vfs.read('/missing')).toThrow('no such file or directory');
    expect(() => vfs.read('/tmp')).toThrow('is a directory');
    expect(() => vfs.write('/missing/dir/f', 'x')).toThrow('no such file or directory');
    expect(() => vfs.list('/etc/../etc/nope')).toThrow('no such file or directory');
    expect(() => vfs.unlink('/')).toThrow('permission denied');
  });

  test('snapshot and restore preserve the tree', () => {
    const vfs = new VFS();
    vfs.mkdirp('/home/work');
    vfs.write('/home/work/notes.txt', 'important');

    const restored = new VFS();
    restored.restore(vfs.snapshot());
    expect(restored.read('/home/work/notes.txt')).toBe('important');
  });
});

describe('synthetic mounts', () => {
  test('a synthetic mount generates content at read time and rejects writes', () => {
    const vfs = new VFS();
    let counter = 0;

    vfs.mountSynthetic('/counter', {
      exists: (rel) => rel === '' || rel === 'value',
      isDir: (rel) => rel === '',
      list: () => ['value'],
      read: () => String(++counter),
    });

    expect(vfs.list('/counter')).toEqual(['value']);
    expect(vfs.read('/counter/value')).toBe('1');
    // Regenerated per read, not cached.
    expect(vfs.read('/counter/value')).toBe('2');
    expect(() => vfs.write('/counter/value', 'x')).toThrow('permission denied');
  });
});

describe('shared memory store', () => {
  test('recall ranks key matches above body matches', () => {
    const store = new MemoryStore();
    store.remember('scheduler-design', 'notes about unrelated things', [], 1);
    store.remember('unrelated-topic', 'a passing mention of scheduler', [], 1);

    const hits = store.recall('scheduler', 5);
    expect(hits[0]!.key).toBe('scheduler-design');
  });

  test('tags are searchable', () => {
    const store = new MemoryStore();
    store.remember('finding-1', 'some body text', ['security', 'urgent'], 2);
    const hits = store.recall('security', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.key).toBe('finding-1');
  });

  test('non-matching queries return nothing', () => {
    const store = new MemoryStore();
    store.remember('alpha', 'beta', [], 1);
    expect(store.recall('completely different words', 5)).toHaveLength(0);
  });

  test('limit is respected and hits are counted', () => {
    const store = new MemoryStore();
    for (let i = 0; i < 10; i++) store.remember(`kernel-note-${i}`, 'kernel details', [], 1);

    expect(store.recall('kernel', 3)).toHaveLength(3);
    expect(store.all().filter((e) => e.hits > 0)).toHaveLength(3);
  });

  test('remembering the same key overwrites and keeps the original timestamp', () => {
    const store = new MemoryStore();
    store.remember('k', 'first', [], 1);
    const created = store.get('k')!.createdAt;
    store.remember('k', 'second', [], 1);

    expect(store.size).toBe(1);
    expect(store.get('k')!.value).toBe('second');
    expect(store.get('k')!.createdAt).toBe(created);
  });

  test('forget removes an entry and reports whether it existed', () => {
    const store = new MemoryStore();
    store.remember('k', 'v', [], 1);
    expect(store.forget('k')).toBe(true);
    expect(store.forget('k')).toBe(false);
  });
});
