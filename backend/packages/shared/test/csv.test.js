import assert from 'node:assert/strict';
import test from 'node:test';
import { csvTextCell } from '../src/index.js';

test('CSV serialization preserves display text and prefixes spreadsheet markers', () => {
  assert.equal(csvTextCell(null), '""');
  assert.equal(csvTextCell('أخبار, "الآن"'), '"أخبار, ""الآن"""');
  assert.equal(csvTextCell('First\r\nSecond'), '"First\r\nSecond"');
  for (const marker of ['=', '+', '-', '@', '＝', '＋', '－', '＠', '\t', '\r', '\n', ' ']) {
    const value = marker + 'text';
    assert.equal(csvTextCell(value), '"' + "'" + value + '"');
  }
});
