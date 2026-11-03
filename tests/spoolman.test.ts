import test from 'node:test';
import assert from 'node:assert/strict';
import { Spoolman, duplicate, identity } from '../server/spoolman.ts';
import type { CommitInput, ImportData, Spool } from '../shared/types.ts';

const label = (overrides: Partial<ImportData> = {}): ImportData => ({
  source: 'nfc', instanceUuid: 'fill-1', nfcUid: 'tag-1',
  brand: 'Prusament', name: 'PLA', material: 'PLA', colorHex: '000000',
  diameter: 1.75, density: 1.24, nominalWeight: 1000, warnings: [], ...overrides,
});
const spool = (id: number, data = label()): Spool => ({
  id, filament: { id: 5 },
  extra: Object.fromEntries(Object.entries(identity(data)).map(([key, value]) => [key, JSON.stringify(value)])),
});

class FakeSpoolman extends Spoolman {
  writes: { path: string; body: any }[] = [];
  rows: Spool[] = [];
  losePostResponse = false;
  reads = 0;
  constructor() { super('http://spoolman'); }
  override async request(path: string, method = 'GET', body?: any): Promise<any> {
    this.reads++;
    if (method !== 'GET') this.writes.push({ path, body });
    if (path.startsWith('/spool?')) return [...this.rows];
    if (path === '/field/spool') return ['prusament_id', 'prusament_source_url', 'openprinttag_instance', 'openprinttag_uid'].map(key => ({ key, field_type: 'text' }));
    if (path === '/filament/5') return { id: 5 };
    if (path === '/spool' && method === 'POST') {
      await Promise.resolve();
      const result = { id: 100 + this.rows.length, filament: { id: body.filament_id }, extra: body.extra };
      this.rows.push(result);
      if (this.losePostResponse) throw new Error('connection lost after write');
      return result;
    }
    if (path.startsWith('/filament?')) return [];
    throw new Error('Unexpected request: ' + method + ' ' + path);
  }
}
const input = (data = label()): CommitInput => ({ data, filamentId: 5, remainingWeight: 700 });

test('refilled tag UID cannot override conflicting instance identity', () => {
  assert.equal(duplicate(spool(1), label({ instanceUuid: 'fill-2' })), false);
  assert.equal(duplicate(spool(1), label()), true);
  assert.equal(duplicate({ ...spool(1), extra: { openprinttag_uid: 'broken json' } }, label()), false);
});

test('ambiguous duplicate spool matches block commit without writes', async () => {
  const client = new FakeSpoolman();
  client.rows = [spool(1), spool(2)];
  await assert.rejects(client.commit(input()), /více cívkám/);
  assert.deepEqual(client.writes, []);
});

test('invalid full and remaining weights fail before reads or writes', async () => {
  for (const [full, remaining] of [[1000, -1], [1000, 1001], [0, 0], [NaN, 0], [Infinity, 1], [1000, NaN]]) {
    const client = new FakeSpoolman();
    await assert.rejects(client.commit({ ...input(label({ nominalWeight: full })), remainingWeight: remaining }), /hmotnost/);
    assert.equal(client.reads, 0);
    assert.deepEqual(client.writes, []);
  }
});

test('fallback filament matching includes normalized color', async () => {
  const client = new FakeSpoolman();
  client.filaments = async () => [
    { id: 1, name: 'PLA', material: 'PLA', diameter: 1.75, color_hex: 'ffffff', vendor: { id: 1, name: 'Prusament' } },
    { id: 2, name: 'pla', material: 'pla', diameter: 1.75, color_hex: '#000000', vendor: { id: 1, name: 'prusament' } },
  ];
  const result = await client.matches(label());
  assert.deepEqual(result.filaments.map(f => f.id), [2]);
});

test('concurrent commits for the same label create one spool', async () => {
  const client = new FakeSpoolman();
  const results = await Promise.all([client.commit(input()), client.commit(input())]);
  assert.deepEqual(results.map(result => result.existing), [false, true]);
  assert.equal(results[0].spool.id, results[1].spool.id);
  assert.equal(client.writes.filter(write => write.path === '/spool').length, 1);
  assert.equal(client.writes[0].body.used_weight, 300);
});

test('lost POST response reconciles persisted spool without another POST', async () => {
  const client = new FakeSpoolman();
  client.losePostResponse = true;
  const result = await client.commit(input());
  assert.equal(result.existing, true);
  assert.equal(result.spool.id, 100);
  assert.equal(client.writes.length, 1);
});

test('lost POST response with ambiguous reconciliation fails explicitly', async () => {
  const client = new FakeSpoolman();
  const original = client.request.bind(client);
  client.request = async (path, method, body) => {
    if (path === '/spool' && method === 'POST') {
      client.rows.push(spool(1), spool(2));
      throw new Error('connection lost');
    }
    return original(path, method, body);
  };
  await assert.rejects(client.commit(input()), /více cívkám/);
});

test('failed queued operation does not block the next commit', async () => {
  const client = new FakeSpoolman();
  const bad = client.commit({ ...input(), remainingWeight: -1 });
  const good = client.commit(input());
  await assert.rejects(bad);
  assert.equal((await good).existing, false);
});

test('missing density for new filament does not mutate custom fields or vendor', async () => {
  const client = new FakeSpoolman();
  await assert.rejects(client.commit({ data: label({ density: undefined }), remainingWeight: 1000 }), /hustotu/);
  assert.deepEqual(client.writes, []);
});

test('request applies configured timeout and API key without a real network', async () => {
  const oldFetch = globalThis.fetch;
  const original = { timeout: process.env.REQUEST_TIMEOUT_MS, key: process.env.SPOOLMAN_API_KEY, header: process.env.SPOOLMAN_API_HEADER };
  process.env.REQUEST_TIMEOUT_MS = '1234';
  process.env.SPOOLMAN_API_KEY = 'test-secret';
  process.env.SPOOLMAN_API_HEADER = 'Authorization';
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'http://spoolman/prefix/api/v1/info');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'test-secret');
    assert.ok(options?.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    const client = new Spoolman('http://spoolman/prefix/');
    assert.deepEqual(await client.request('/info'), { ok: true });
    process.env.REQUEST_TIMEOUT_MS = '-1';
    await assert.rejects(client.request('/info'), /REQUEST_TIMEOUT_MS/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries({ REQUEST_TIMEOUT_MS: original.timeout, SPOOLMAN_API_KEY: original.key, SPOOLMAN_API_HEADER: original.header })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
