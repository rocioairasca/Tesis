import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The existing .jsx utility contains plain JS; load without adding a test bundler.
const source = await readFile(new URL('../src/utils/harvestUtils.jsx', import.meta.url), 'utf8');
const { formatHectares, parseHectaresInput, formatHectaresInput } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('comma and dot inputs produce numeric values and two-decimal Spanish output', () => {
  for (const [input, number, display] of [
    ['20', 20, '20,00'], ['20,5', 20.5, '20,50'], ['20,50', 20.5, '20,50'],
    ['20.5', 20.5, '20,50'], ['20.50', 20.5, '20,50'], ['0', 0, '0,00'],
  ]) {
    const parsed = parseHectaresInput(input);
    assert.equal(parsed, number);
    assert.equal(typeof parsed, 'number');
    assert.equal(formatHectaresInput(parsed, { userTyping: false }), display);
    assert.equal(JSON.parse(JSON.stringify({ harvested_area_ha: parsed })).harvested_area_ha, number);
  }
});

test('extra decimal places round rather than truncate, including half-cent values', () => {
  for (const [input, expected] of [['8,034', 8.03], ['8,035', 8.04], ['8.039', 8.04], ['1.005', 1.01]]) {
    assert.equal(parseHectaresInput(input), expected);
    assert.equal(formatHectaresInput(parseHectaresInput(input)), String(expected.toFixed(2)).replace('.', ','));
  }
});

test('display always includes two decimals and hectares', () => {
  for (const [input, expected] of [[48.03, '48,03 ha'], [20, '20,00 ha'], [0, '0,00 ha'], [8.035, '8,04 ha']]) {
    assert.equal(formatHectares(input), expected);
  }
  assert.equal(formatHectaresInput(1234.5), '1234,50');
});

test('unfinished typing survives until blur; empty/invalid input does not become zero', () => {
  assert.equal(formatHectaresInput(20, { userTyping: true, input: '20,' }), '20,');
  assert.equal(formatHectaresInput(parseHectaresInput('20,'), { userTyping: false }), '20,00');
  for (const input of ['', null, undefined, 'abc', '20,5.0', 'Infinity', '-2']) {
    assert.equal(parseHectaresInput(input), '');
  }
  assert.equal(formatHectaresInput(null), '');
});
