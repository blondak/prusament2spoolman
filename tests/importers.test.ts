import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPrusamentPage, isPublicAddress, normalizePrusamentUrl, parseOpenPrintTag, parsePrusamentHtml, previewInput } from '../server/importers.ts';

// Test-only fixture encoder, independent of the production reader.
const encode = (value: unknown): Buffer => {
  const header = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const bytes = Buffer.alloc(3); bytes[0] = (major << 5) | 25; bytes.writeUInt16BE(n, 1); return bytes;
  };
  if (typeof value === 'number') {
    if (Number.isInteger(value) && Math.abs(value) < 65536) return header(value >= 0 ? 0 : 1, value >= 0 ? value : -1 - value);
    const bytes = Buffer.alloc(9); bytes[0] = 0xfb; bytes.writeDoubleBE(value, 1); return bytes;
  }
  if (typeof value === 'string') { const bytes = Buffer.from(value); return Buffer.concat([header(3, bytes.length), bytes]); }
  if (value instanceof Uint8Array) return Buffer.concat([header(2, value.length), value]);
  if (value instanceof Map) return Buffer.concat([header(5, value.size), ...[...value].flatMap(([key, item]) => [encode(key), encode(item)])]);
  if (Array.isArray(value)) return Buffer.concat([header(4, value.length), ...value.map(encode)]);
  throw new Error('Unsupported fixture type');
};
const mainFields = () => new Map<number, unknown>([
  [8, 0], [9, 1], [10, 'PETG Orange'], [11, 'Prusament'], [5, 'ABC123'], [6, 'PETG-ORANGE'],
  [16, 1000], [17, 1031.5], [18, 201], [19, Buffer.from([255, 123, 0, 128])],
  [29, 1.27], [30, 1.75], [34, 230], [37, 80], [0, Buffer.from('00112233445566778899aabbccddeeff', 'hex')],
]);
const compactPayload = (main = mainFields()) => Buffer.concat([Buffer.from([0xa0]), encode(main)]);

test('Prusament data parses safely, preserves Unicode and does not subtract spool tare', () => {
  const data = { weight: 1034, spool_weight: 198, diameter: '1.75', ff_goods_id: 341, filament: { name: "PLA Gentleman's šedá 1kg", material: 'PLA', color_rgb: '#AABBCC', he_min: 215, hb_min: 60 } };
  const string = JSON.stringify(data).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const result = parsePrusamentHtml(`<script>var spoolData = '${string}'; maliciousCall();</script>`, 'https://prusament.com/spool/?spoolId=ABC123');
  assert.equal(result.name, data.filament.name);
  assert.equal(result.initialWeight, 1034);
  assert.equal(result.spoolWeight, 198);
  assert.equal(result.nominalWeight, 1000);
  assert.equal(result.prusamentId, 'ABC123');
  assert.equal(result.productId, '341');
  assert.equal(result.colorHex, 'AABBCC');
  assert.equal(result.density, 1.24);
  assert.equal(result.warnings.length, 2);
});

test('Prusament rejects a generic page, executable expressions and truncated JSON', () => {
  assert.throws(() => parsePrusamentHtml('<title>Prusament</title>', 'https://prusament.com'), /spoolData/);
  for (const data of ['var spoolData = evil();', `var spoolData = '{"filament":';`, `var spoolData = '\\xZZ';`]) {
    assert.throws(() => parsePrusamentHtml(data, 'https://prusament.com'));
  }
});

test('URL guard blocks credentials, nonstandard ports, private addresses and lookalike hosts', () => {
  for (const url of ['http://127.0.0.1', 'https://prusament.com.evil.test', 'https://prusament.com:8443/', 'https://user:pass@prusament.com', 'file:///etc/passwd', 'https://[::1]/']) {
    assert.throws(() => normalizePrusamentUrl(url));
  }
  assert.equal(normalizePrusamentUrl('prusa.io/ABC123').href, 'https://prusa.io/ABC123');
  assert.equal(normalizePrusamentUrl('ABC123').href, 'https://prusa.io/s/ABC123');
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.1.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', '::ffff:127.0.0.1', '2001:db8::1', '2001:2::1', '2001:10::1', '3fff::1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700::1111'), true);
});

test('every redirect is validated before the next request', async () => {
  const called: string[] = [];
  await assert.rejects(fetchPrusamentPage('https://prusa.io/ABC123', async url => {
    called.push(url.href);
    return { status: 302, location: 'http://169.254.169.254/latest/meta-data/', body: '' };
  }), /Povoleny/);
  assert.equal(called.length, 1);
  const result = await fetchPrusamentPage('https://prusa.io/ABC123', async url => url.hostname === 'prusa.io'
    ? { status: 302, location: 'https://prusament.com/spool/?spoolId=ABC123', body: '' }
    : { status: 200, body: '<html>fixture</html>' });
  assert.equal(result.url, 'https://prusament.com/spool/?spoolId=ABC123');
  await assert.rejects(fetchPrusamentPage('prusa.io/x', async () => ({ status: 302, location: '/x', body: '' })), /přesměrování/);
  await assert.rejects(fetchPrusamentPage('prusa.io/x', async () => ({ status: 200, body: 'x'.repeat(2 * 1024 * 1024 + 1) })), /velká/);
});

test('OpenPrintTag compact regions map net weights, UUID, temperatures and color', () => {
  const result = parseOpenPrintTag(compactPayload(), 'E0:04:01:02:03:04:05:06');
  assert.equal(result.name, 'PETG Orange');
  assert.equal(result.material, 'PETG');
  assert.equal(result.prusamentId, 'ABC123');
  assert.equal(result.instanceUuid, '00112233-4455-6677-8899-aabbccddeeff');
  assert.equal(result.nfcUid, 'E004010203040506');
  assert.equal(result.initialWeight, 1031.5);
  assert.equal(result.spoolWeight, 201);
  assert.equal(result.colorHex, 'FF7B00');
  assert.equal(result.nozzleTemp, 230);
  assert.equal(result.bedTemp, 80);
});

test('explicit regions support padding, unsorted fields, auxiliary usage, and unknown keys', () => {
  const main = mainFields();
  main.set(400, [new Map([['future', 'value']]), Buffer.from([1, 2])]);
  const encodedMain = encode(main);
  const payload = Buffer.alloc(384);
  encode(new Map([[2, 320], [3, 64], [0, 32], [1, 288]])).copy(payload);
  encodedMain.copy(payload, 32);
  encode(new Map([[0, 31.5]])).copy(payload, 320);
  const result = parseOpenPrintTag(payload);
  assert.equal(result.remainingWeight, 1000);
  assert.deepEqual(result.warnings, []);
});

test('bounds, overlap, malformed CBOR, duplicate keys and invalid known fields are rejected', () => {
  const cases = [
    Buffer.from([0xa0, 0xbf, 8, 0]), // unterminated indefinite map
    Buffer.from([0xa0, 0xa2, 8, 0, 8, 0]), // duplicate key
    Buffer.concat([encode(new Map([[0, 999]])), encode(mainFields())]),
    Buffer.concat([encode(new Map([[0, 0]])), encode(mainFields())]),
    Buffer.concat([encode(new Map([[0, 20], [1, 100], [2, 30], [3, 50]])), Buffer.alloc(200)]),
    Buffer.concat([Buffer.from([0xa0, 0xa1, 10, 0x7a, 0xff, 0xff, 0xff, 0xff])]),
    Buffer.concat([Buffer.from([0xa0, 0xa1, 10]), Buffer.alloc(26, 0x81), Buffer.from([0])]),
  ];
  for (const payload of cases) assert.throws(() => parseOpenPrintTag(payload));
  for (const [key, value] of [[17, -1], [29, Infinity], [30, 1750], [0, Buffer.alloc(15)], [19, Buffer.alloc(8)], [10, 'x'.repeat(64)]] as [number, unknown][]) {
    const main = mainFields(); main.set(key, value);
    assert.throws(() => parseOpenPrintTag(compactPayload(main)), `field ${key}`);
  }
});

test('NFC preview checks MIME and strict base64, preserving nominal fallback and empty remaining weight', async () => {
  const main = mainFields(); main.delete(17);
  const payload = Buffer.alloc(384);
  encode(new Map([[0, 32], [1, 288], [2, 320], [3, 64]])).copy(payload);
  encode(main).copy(payload, 32);
  encode(new Map([[0, 1000]])).copy(payload, 320);
  const result = await previewInput({ records: [{ mediaType: 'application/vnd.openprinttag', data: payload.toString('base64') }] });
  assert.equal(result.initialWeight, 1000);
  assert.equal(result.remainingWeight, 0);
  await assert.rejects(previewInput({ records: [{ mediaType: 'application/vnd.openprinttag', data: '$invalid' }] }), /Base64/);
  await assert.rejects(previewInput({ records: [{ mediaType: 'text/plain', data: 'abcd' }] }), /OpenPrintTag/);
});

 test('QR density derives from measured geometry and avoids composite guesses', () => {
  const parse = (data: unknown) => parsePrusamentHtml(`var spoolData = ${JSON.stringify(JSON.stringify(data))};`, 'https://prusament.com/spool/?spoolId=X');
  const measured = parse({ weight: 1000, length: 335, diameter: 1.75, filament: { name: 'PETG Orange', material: 'PETG' } });
  assert.equal(measured.density, 1.241);
  assert.ok(measured.warnings.some(warning => warning.includes('vypočtena')));
  const composite = parse({ filament: { name: 'PLA Carbon Fiber', material: 'PLA' } });
  assert.equal(composite.density, undefined);
  assert.ok(composite.warnings.some(warning => warning.includes('nebyla zjištěna')));
});
