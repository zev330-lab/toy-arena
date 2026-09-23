import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeBackup, deserializeBackup } from '../../js/core/backup.js';

// node has Blob built in
const toDataURL = async (b) => `data:${b.type};base64,${Buffer.from(await b.arrayBuffer()).toString('base64')}`;
const fromDataURL = async (d) => { const [h, b64] = d.split(','); return new Blob([Buffer.from(b64, 'base64')], { type: h.slice(5, h.indexOf(';')) }); };

test('backup round-trips toys including image blobs', async () => {
  const toys = [{
    id: 't1', name: 'Claw Crusher', power: 'claws', stats: { power: 80, speed: 70, defense: 60 }, wins: 3, xp: 120,
    contour: { shapes: [{ outer: [[0, 0], [1, 0], [0, 1]], holes: [] }] },
    frontBlob: new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/png' }), backBlob: null,
    thumbBlob: new Blob([new Uint8Array([9, 9])], { type: 'image/png' }),
  }];
  const json = await serializeBackup(toys, toDataURL, { ownerName: 'Sam' });
  assert.equal(typeof json, 'string');
  assert.ok(!json.includes('frontBlob'));
  const { toys: back, ownerName, skipped } = await deserializeBackup(json, fromDataURL);
  assert.equal(ownerName, 'Sam');
  assert.equal(skipped, 0);
  assert.equal(back[0].name, 'Claw Crusher');
  assert.deepEqual(back[0].stats, toys[0].stats);
  assert.deepEqual(back[0].contour, toys[0].contour);
  assert.deepEqual([...new Uint8Array(await back[0].frontBlob.arrayBuffer())], [1, 2, 3, 250]);
  assert.equal(back[0].frontBlob.type, 'image/png');
  assert.equal(back[0].backBlob, null);
});

test('rejects files that are not backups', async () => {
  await assert.rejects(() => deserializeBackup('{"hello":1}', fromDataURL), /not a Toy Arena backup/);
  await assert.rejects(() => deserializeBackup('not json', fromDataURL), /not a Toy Arena backup/);
});

test('skips malformed toy records instead of failing the whole restore', async () => {
  const json = JSON.stringify({ app: 'toy-arena', version: 1, toys: [{ id: 5 }, { id: 'ok', name: 'A', frontData: 'data:image/png;base64,AQ==' }] });
  const { toys, skipped } = await deserializeBackup(json, fromDataURL);
  assert.equal(toys.length, 1);
  assert.equal(skipped, 1);
});
