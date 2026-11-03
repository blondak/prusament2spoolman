import { lookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { ImportData } from '../shared/types.js';

const allowedHosts = new Set(['prusa.io', 'www.prusa.io', 'prusament.com', 'www.prusament.com']);
const MAX_PAGE = 2 * 1024 * 1024;
const MAX_PAYLOAD = 64 * 1024;
const fail = (message: string): never => { throw new Error(message); };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, max = 256): string | undefined => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined;
const number = (v: unknown, min = 0, max = 100_000): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(?:[.,]\d+)?$/.test(v.trim()) ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

export function normalizePrusamentUrl(input: string): URL {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) return fail('Zadejte platnou adresu Prusament.');
  let value = input.trim();
  // Printed spool identifiers can be entered without scanning the QR code.
  if (/^[a-zA-Z0-9]{5,32}$/.test(value)) value = `https://prusa.io/s/${encodeURIComponent(value)}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  let url: URL;
  try { url = new URL(value); } catch { return fail('Neplatná adresa Prusament.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !allowedHosts.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) {
    return fail('Povoleny jsou pouze adresy prusa.io a prusament.com se standardním portem a bez přihlašovacích údajů.');
  }
  url.hash = '';
  return url;
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19, 51].includes(b) || a === 203 && b === 0);
  }
  // Only global unicast IPv6; reject documentation and transition ranges too.
  if (isIP(address) !== 6 || !/^[23]/.test(address)) return false;
  const [first, second = '0'] = address.toLowerCase().split(':');
  return first !== '2002' && first !== '3fff' && !(first === '2001' && (parseInt(second || '0', 16) < 0x200 || second === 'db8'));
}

type PageResponse = { status: number; location?: string; body: string };
type PageRequest = (url: URL, signal: AbortSignal) => Promise<PageResponse>;
const requestPage: PageRequest = (url, signal) => new Promise((resolve, reject) => {
  // Node forwards this socket option; @types/node omits it from HTTP RequestOptions.
  const options: import('node:https').RequestOptions & { autoSelectFamily: boolean } = {
    signal, autoSelectFamily: false,
    headers: { 'user-agent': 'Prusament-Spoolman-Importer/1.0', accept: 'text/html', 'accept-encoding': 'identity' },
    lookup: (host, _options, callback) => {
      lookup(host, { all: true }, (error, addresses) => {
        if (error) return callback(error, '', 4);
        if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) return callback(new Error('Adresa serveru není veřejná.'), '', 4);
        // The actual socket uses this checked result; no second DNS resolution.
        callback(null, addresses[0].address, addresses[0].family);
      });
    },
  };
  const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, response => {
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) { response.resume(); resolve({ status, location: response.headers.location, body: '' }); return; }
    if (Number(response.headers['content-length']) > MAX_PAGE) { response.destroy(); reject(new Error('Stránka je příliš velká.')); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PAGE) { response.destroy(new Error('Stránka je příliš velká.')); return; }
      chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
  });
  request.on('error', reject);
  request.end();
});

export async function fetchPrusamentPage(input: string, requester: PageRequest = requestPage): Promise<{ html: string; url: string }> {
  let url = normalizePrusamentUrl(input);
  const signal = AbortSignal.timeout(12_000);
  for (let redirect = 0; redirect <= 5; redirect++) {
    const response = await requester(url, signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || redirect === 5) return fail('Neplatné nebo příliš dlouhé přesměrování.');
      url = normalizePrusamentUrl(new URL(response.location, url).href);
      continue;
    }
    if (response.status < 200 || response.status >= 300) return fail(`Prusament vrátil chybu HTTP ${response.status}.`);
    if (Buffer.byteLength(response.body) > MAX_PAGE) return fail('Stránka je příliš velká.');
    return { html: response.body, url: url.href };
  }
  return fail('Nepodařilo se načíst stránku.');
}

// Decode a quoted JavaScript string literal without executing page code.
function quotedString(source: string, start: number): string {
  const quote = source[start];
  let result = '';
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === quote) return result;
    if (ch !== '\\') { result += ch; continue; }
    const next = source[++i];
    const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
    if (next === 'x' || next === 'u') {
      const len = next === 'x' ? 2 : 4;
      const hex = source.slice(i + 1, i + 1 + len);
      if (!new RegExp(`^[a-f0-9]{${len}}$`, 'i').test(hex)) return fail('Poškozená data spoolData.');
      result += String.fromCharCode(parseInt(hex, 16)); i += len;
    } else if (next === '\n') { /* JS line continuation */ }
    else if (next === '\r') { if (source[i + 1] === '\n') i++; }
    else result += escapes[next] ?? next;
  }
  return fail('Neukončená data spoolData.');
}

export function parsePrusamentHtml(html: string, sourceUrl: string): ImportData {
  const assignment = /\b(?:var|let|const)\s+spoolData\s*=\s*/i.exec(html);
  if (!assignment) return fail('Na stránce nejsou údaje konkrétní cívky (spoolData).');
  const start = assignment.index + assignment[0].length;
  let raw: unknown;
  try {
    if (!['"', "'"].includes(html[start])) return fail('Nepodporovaný formát dat spoolData.');
    raw = JSON.parse(quotedString(html, start));
  } catch { return fail('Data cívky na stránce jsou poškozená.'); }
  const spool = object(raw), filament = object(spool.filament);
  const name = text(filament.name);
  if (!name) return fail('Na stránce chybí název filamentu.');
  const warnings: string[] = [];
  const material = text(filament.material, 64) ?? /\b(PLA|PETG|PCTG|ASA|ABS|PC|PVB|PA11|PA12|PA6|TPU|TPE|PP|PEI)\b/i.exec(name)?.[1].toUpperCase() ?? '';
  if (!material) warnings.push('Materiál nebyl rozpoznán; doplňte jej.');
  const initialWeight = number(spool.weight, 1);
  if (initialWeight !== undefined) warnings.push('Hmotnost z QR je výrobní údaj; ověřte, že jde o čistou hmotnost filamentu. Hmotnost prázdné cívky se automaticky neodečítá.');
  const diameter = number(spool.diameter, 0.5, 4) ?? 1.75;
  if (spool.diameter === undefined) warnings.push('Průměr nebyl uveden; použito 1,75 mm.');
  let density = number(filament.density, 0.1, 30);
  const lengthMetres = number(spool.length, 0.1);
  if (density === undefined && initialWeight !== undefined && lengthMetres !== undefined) {
    const calculated = initialWeight / (lengthMetres * Math.PI * (diameter / 2) ** 2);
    if (calculated >= 0.3 && calculated <= 3) {
      density = Math.round(calculated * 1000) / 1000;
      warnings.push('Hustota je vypočtena z výrobní hmotnosti, délky a průměru; ověřte tyto údaje.');
    }
  }
  const typicalDensity: Record<string, number> = { PLA: 1.24, PETG: 1.27, ASA: 1.07, ABS: 1.04 };
  if (density === undefined && Object.hasOwn(typicalDensity, material.toUpperCase()) && !/\b(?:CF|GF|carbon|glass|wood|metal|bronze|steel)\b/i.test(name)) {
    density = typicalDensity[material.toUpperCase()];
    warnings.push('Hustota je odhad podle typu materiálu; v případě potřeby ji upravte.');
  }
  if (density === undefined) warnings.push('Hustota nebyla zjištěna; doplňte ji podle výrobce.');
  const color = text(filament.color_rgb)?.replace(/^#/, '');
  const url = new URL(sourceUrl);
  const prusamentId = text(spool.spool_id) ?? text(spool.spoolId) ?? text(url.searchParams.get('spoolId')) ?? (url.hostname.endsWith('prusa.io') ? text(url.pathname.split('/').filter(Boolean).pop()) : undefined);
  const nominalMatch = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(kg|g)(?:\s|$)/i.exec(name);
  const nominalWeight = number(spool.nominal_weight, 1) ?? (nominalMatch ? Number(nominalMatch[1].replace(',', '.')) * (nominalMatch[2].toLowerCase() === 'kg' ? 1000 : 1) : undefined);
  return {
    source: 'qr', sourceUrl, prusamentId,
    productId: text(spool.article_number) ?? text(filament.article_number) ?? (typeof spool.ff_goods_id === 'number' ? String(spool.ff_goods_id) : text(spool.ff_goods_id)),
    brand: 'Prusament', name, material, diameter,
    colorHex: color && /^[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : undefined,
    density, initialWeight, nominalWeight, spoolWeight: number(spool.spool_weight),
    remainingWeight: initialWeight, nozzleTemp: number(filament.he_min, 0, 600), bedTemp: number(filament.hb_min, 0, 300), warnings,
  };
}

// Format reference: https://github.com/OpenPrintTag/openprinttag-specification/blob/main/docs_src/nfc_data_format.md
// A bounded CBOR reader supports standard CBOR, including indefinite containers.
// Each OpenPrintTag section is limited to 512 bytes by the official specification.
function readSection(payload: Uint8Array, offset: number, end: number): { map: Map<number, unknown>; end: number } {
  const bytes = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  const limit = Math.min(end, offset + 512);
  let position = offset;
  const take = (length: number) => {
    if (!Number.isSafeInteger(length) || length < 0 || position + length > limit) return fail('Poškozená nebo příliš dlouhá sekce CBOR.');
    const start = position; position += length; return bytes.subarray(start, position);
  };
  const read = (depth = 0): unknown => {
    if (depth > 24) return fail('CBOR obsahuje příliš hluboké vnoření.');
    const head = take(1)[0], major = head >> 5, info = head & 31;
    if (info >= 28 && info <= 30) return fail('Neplatný formát CBOR.');
    let arg = info;
    if (info === 24) arg = take(1)[0];
    if (info === 25) arg = take(2).readUInt16BE();
    if (info === 26) arg = take(4).readUInt32BE();
    if (info === 27) {
      const part = take(8);
      if (major === 7) return part.readDoubleBE();
      const big = part.readBigUInt64BE();
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
        if (major === 0) return big;
        if (major === 1) return -1n - big;
        if (major === 6) return read(depth + 1);
        return fail('Neplatná délka CBOR.');
      }
      arg = Number(big);
    }
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22 || info === 23) return null;
      if (info === 25) { const sign = arg & 0x8000 ? -1 : 1, exp = (arg >> 10) & 31, fraction = arg & 1023; return sign * (exp === 31 ? fraction ? NaN : Infinity : exp === 0 ? 2 ** -14 * fraction / 1024 : 2 ** (exp - 15) * (1 + fraction / 1024)); }
      if (info === 26) { const b = Buffer.alloc(4); b.writeUInt32BE(arg); return b.readFloatBE(); }
      if (info === 31) return fail('Neočekávaný konec CBOR.');
      return undefined;
    }
    if (info === 31 && ![2, 3, 4, 5].includes(major)) return fail('Neplatný neurčitý CBOR typ.');
    if (major === 0) return arg;
    if (major === 1) return -1 - arg;
    if (major === 6) return read(depth + 1); // Unknown semantic tags do not change field storage.
    if (major === 2 || major === 3) {
      let data: Buffer;
      if (info === 31) {
        const pieces: Buffer[] = [];
        while (bytes[position] !== 255) {
          if (position >= limit || bytes[position] >> 5 !== major || (bytes[position] & 31) === 31) return fail('Neplatný řetězec CBOR.');
          const value = read(depth + 1);
          pieces.push(typeof value === 'string' ? Buffer.from(value) : value as Buffer);
        }
        take(1); data = Buffer.concat(pieces);
      } else data = take(arg);
      if (major === 2) return data;
      try { return new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { return fail('Neplatné UTF-8 v NFC tagu.'); }
    }
    if (major === 4 || major === 5) {
      if (info !== 31 && arg > 512) return fail('Příliš mnoho položek CBOR.');
      const map = new Map<unknown, unknown>(), array: unknown[] = [];
      for (let i = 0; info === 31 ? bytes[position] !== 255 : i < arg; i++) {
        const value = read(depth + 1);
        if (major === 5) { if (map.has(value)) return fail('Duplicitní klíč CBOR.'); map.set(value, read(depth + 1)); }
        else array.push(value);
      }
      if (info === 31) take(1);
      return major === 5 ? map : array;
    }
    return fail('Neplatná data CBOR.');
  };
  const result = read();
  if (!(result instanceof Map) || [...result.keys()].some(key => !Number.isInteger(key) || key < 0 || key > 65535)) return fail('Sekce OpenPrintTag musí být mapa s celočíselnými klíči.');
  return { map: result, end: position };
}

const materials = ['PLA','PETG','TPU','ABS','ASA','PC','PCTG','PP','PA6','PA11','PA12','PA66','CPE','TPE','HIPS','PHA','PET','PEI','PBT','PVB','PVA','PEKK','PEEK','BVOH','TPC','PPS','PPSU','PVC','PEBA','PVDF','PPA','PCL','PES','PMMA','POM','PPE','PS','PSU','TPI','SBS','OBC','EVA','PA612'];

export function parseOpenPrintTag(payload: Uint8Array, uid?: string): ImportData {
  if (payload.length < 2 || payload.length > MAX_PAYLOAD) return fail('Neplatná velikost NFC dat.');
  const meta = readSection(payload, 0, payload.length);
  const offset = (key: number): number | undefined => {
    const value = meta.map.get(key);
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > payload.length) return fail('Neplatný offset nebo velikost NFC regionu.');
    return value;
  };
  const mainStart = offset(0) ?? meta.end, auxStart = offset(2);
  const mainEnd = mainStart + (offset(1) ?? ((auxStart !== undefined && auxStart > mainStart ? auxStart : payload.length) - mainStart));
  const auxEnd = auxStart === undefined ? undefined : auxStart + (offset(3) ?? ((mainStart > auxStart ? mainStart : payload.length) - auxStart));
  if (mainStart < meta.end || mainEnd > payload.length || mainEnd <= mainStart || (auxStart !== undefined && (auxStart < meta.end || auxEnd! > payload.length || auxEnd! <= auxStart || mainStart < auxEnd! && auxStart < mainEnd))) return fail('NFC regiony se překrývají nebo leží mimo data.');
  if (auxStart === undefined && meta.map.has(3)) return fail('NFC region nemá offset.');
  const main = readSection(payload, mainStart, mainEnd).map;
  const aux = auxStart === undefined ? new Map<number, unknown>() : readSection(payload, auxStart, auxEnd!).map;
  if (main.get(8) !== 0) return fail('NFC tag neobsahuje FFF filament.');
  const warnings: string[] = [];
  const numeric = (key: number, min = 0, max = 100_000) => {
    const raw = main.get(key);
    if (raw === undefined) return undefined;
    const result = typeof raw === 'number' ? number(raw, min, max) : undefined;
    if (result === undefined) return fail(`Neplatná číselná hodnota NFC pole ${key}.`);
    return result;
  };
  const fieldText = (key: number, max: number) => {
    const raw = main.get(key);
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > max || !raw.trim()) return fail(`Neplatný text NFC pole ${key}.`);
    return raw.trim();
  };
  const materialCode = numeric(9, 0, 65535);
  if (materialCode !== undefined && !Number.isInteger(materialCode)) return fail('Neplatný typ materiálu v NFC tagu.');
  const material = materialCode === undefined ? '' : materials[materialCode] ?? '';
  if (!material) warnings.push('Typ materiálu není znám; doplňte jej ručně.');
  const brand = fieldText(11, 31) ?? '', name = fieldText(10, 63) ?? '';
  if (!brand || !name) warnings.push('NFC tag nemá úplný název výrobce a materiálu.');
  const nominalWeight = numeric(16, 1), initialWeight = numeric(17, 1) ?? nominalWeight;
  const consumed = aux.get(0);
  if (consumed !== undefined && (typeof consumed !== 'number' || number(consumed) === undefined || initialWeight !== undefined && consumed > initialWeight)) return fail('Neplatná spotřebovaná hmotnost NFC tagu.');
  let remainingWeight = initialWeight;
  if (initialWeight !== undefined && typeof consumed === 'number') remainingWeight = initialWeight - consumed;
  if (consumed === undefined) warnings.push('Tag neuvádí spotřebu. U použité cívky upravte zbývající hmotnost.');
  const color = main.get(19);
  if (color !== undefined && (!(color instanceof Uint8Array) || ![3, 4].includes(color.length))) return fail('Neplatná barva v NFC tagu.');
  const uuid = main.get(0);
  if (uuid !== undefined && (!(uuid instanceof Uint8Array) || uuid.length !== 16)) return fail('Neplatné UUID v NFC tagu.');
  const uuidHex = uuid instanceof Uint8Array ? Buffer.from(uuid).toString('hex') : undefined;
  const instanceUuid = uuidHex?.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  const cleanUid = uid?.replace(/[: -]/g, '').toUpperCase();
  if (cleanUid && (!/^[0-9A-F]+$/.test(cleanUid) || ![8, 14, 16, 20].includes(cleanUid.length))) return fail('Neplatné UID NFC tagu.');
  const prusamentId = /^prusament$/i.test(brand) ? fieldText(5, 16) : undefined;
  return {
    source: 'nfc', instanceUuid, nfcUid: cleanUid || undefined, prusamentId, productId: fieldText(6, 16), brand, name, material,
    diameter: numeric(30, 0.5, 4) ?? 1.75, density: numeric(29, 0.1, 30), nominalWeight, initialWeight,
    spoolWeight: numeric(18), remainingWeight, colorHex: color instanceof Uint8Array ? Buffer.from(color.subarray(0, 3)).toString('hex').toUpperCase() : undefined,
    nozzleTemp: numeric(34, 0, 600), bedTemp: numeric(37, 0, 300), warnings,
  };
}

export async function previewInput(body: { input?: string; records?: { mediaType: string; data: string }[]; uid?: string }): Promise<ImportData> {
  if (body.records?.length) {
    const records = body.records.filter(record => record.mediaType.toLowerCase() === 'application/vnd.openprinttag');
    if (records.length !== 1) return fail('NFC musí obsahovat právě jeden záznam OpenPrintTag.');
    const encoded = records[0].data;
    if (encoded.length > Math.ceil(MAX_PAYLOAD / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return fail('Neplatná Base64 data NFC.');
    return parseOpenPrintTag(Buffer.from(encoded, 'base64'), body.uid);
  }
  if (!body.input) return fail('Načtěte QR kód nebo NFC tag.');
  const page = await fetchPrusamentPage(body.input);
  return parsePrusamentHtml(page.html, page.url);
}
