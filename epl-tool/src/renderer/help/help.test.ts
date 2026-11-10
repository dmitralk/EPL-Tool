import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HELP_BLOCKS, HELP_VALUES, fillHelpValues } from './values';

// The topics are bundled by Vite ("?raw" imports in index.ts), so here they are read from disk, and the topic list is read
// from index.ts as text.
const dir = __dirname;
const index = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
const fileOf = new Map([...index.matchAll(/^import (\w+) from '\.\/([\w-]+\.md)\?raw';$/gm)].map(m => [m[1], m[2]]));
const topics = [...index.matchAll(/\{ id: '([\w-]+)', body: (\w+) \}/g)].map(m => ({ id: m[1], file: fileOf.get(m[2]) }));
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

describe('Help topics', () => {
  it('every Markdown file is listed once, with a title', () => {
    assert.ok(topics.length > 0);
    assert.deepEqual([...topics.map(t => t.file)].sort(), [...files].sort());
    for (const f of files) assert.match(read(f), /^# \S/, `${f} starts with a "# " title`);
  });

  it('every {{placeholder}} is a known value or block', () => {
    for (const f of files) {
      for (const line of read(f).split(/\r?\n/)) {
        const block = /^\{\{(\w+)\}\}$/.exec(line.trim());
        if (block && (HELP_BLOCKS as readonly string[]).includes(block[1])) continue;
        for (const m of line.matchAll(/\{\{(\w+)\}\}/g)) {
          assert.ok(m[1] in HELP_VALUES, `${f}: unknown placeholder {{${m[1]}}}`);
        }
      }
    }
  });

  it('every help: link points to a topic', () => {
    const ids = new Set(topics.map(t => t.id));
    for (const f of files) {
      for (const m of read(f).matchAll(/\]\(help:([\w-]+)\)/g)) assert.ok(ids.has(m[1]), `${f}: no topic "${m[1]}"`);
    }
  });

  it('values are filled in, unknown names are left as they are', () => {
    for (const [name, value] of Object.entries(HELP_VALUES)) {
      assert.ok(value.trim(), `${name} has a value`);
      assert.equal(fillHelpValues(`a {{${name}}} b`), `a ${value} b`);
    }
    assert.equal(fillHelpValues('{{NOT_A_VALUE}}'), '{{NOT_A_VALUE}}');
  });
});
