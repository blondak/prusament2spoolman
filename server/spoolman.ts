import type { ImportData, Filament, Spool, CommitInput } from '../shared/types.js';

const fields: Record<string, string> = {
  prusament_id: 'Prusament ID',
  prusament_source_url: 'Prusament URL',
  openprinttag_instance: 'OpenPrintTag instance',
  openprinttag_uid: 'OpenPrintTag UID',
};

export function identity(data: ImportData): Record<string, string> {
  return Object.fromEntries(Object.entries({
    prusament_id: data.prusamentId,
    prusament_source_url: data.sourceUrl,
    openprinttag_instance: data.instanceUuid,
    openprinttag_uid: data.nfcUid,
  }).filter((entry): entry is [string, string] => Boolean(entry[1])));
}

function extraValue(spool: Spool, key: string): string | undefined {
  try {
    const value: unknown = JSON.parse(spool.extra?.[key] ?? 'null');
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function duplicate(spool: Spool, data: ImportData): boolean {
  const identifiers = identity(data);
  // A reused physical tag can identify a different fill. A conflicting fill ID
  // takes precedence over shared tag UID or URL.
  for (const key of ['openprinttag_instance', 'prusament_id']) {
    const stored = extraValue(spool, key);
    if (stored && identifiers[key] && stored !== identifiers[key]) return false;
  }
  return Object.entries(identifiers).some(([key, value]) => extraValue(spool, key) === value)
    || Boolean(data.sourceUrl && spool.comment?.trim() === data.sourceUrl);
}

function uniqueSpool(spools: Spool[], data: ImportData): Spool | undefined {
  const matches = spools.filter(spool => duplicate(spool, data));
  if (matches.length > 1) throw new Error('Identifikátor odpovídá více cívkám. Zkontrolujte duplicity ve Spoolmanu.');
  return matches[0];
}

const normalized = (value?: string) => value?.trim().toLowerCase();
const normalizedColor = (value?: string) => normalized(value)?.replace(/^#/, '');

function matchesFilament(filament: Filament, data: ImportData): boolean {
  if (normalized(filament.vendor?.name) !== normalized(data.brand)) return false;
  if (data.productId && (filament.article_number === data.productId || filament.external_id === data.productId)) return true;
  return normalized(filament.name) === normalized(data.name)
    && normalized(filament.material) === normalized(data.material)
    && Math.abs((filament.diameter ?? 0) - data.diameter) < 0.01
    && normalizedColor(filament.color_hex) === normalizedColor(data.colorHex);
}

function remainingWeight(input: CommitInput): number {
  const full = input.data.initialWeight ?? input.data.nominalWeight;
  if (full === undefined || !Number.isFinite(full) || full <= 0
      || !Number.isFinite(input.remainingWeight) || input.remainingWeight < 0
      || input.remainingWeight > full) {
    throw new Error('Doplňte platnou plnou hmotnost a nezápornou zbývající hmotnost, která ji nepřekračuje.');
  }
  return full;
}

export class Spoolman {
  private url: string;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(url = process.env.SPOOLMAN_URL ?? '') {
    this.url = url;
  }

  async request(path: string, method = 'GET', body?: unknown): Promise<any> {
    if (!this.url) throw new Error('Není nastaven SPOOLMAN_URL.');
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS ?? 15000);
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647) {
      throw new Error('REQUEST_TIMEOUT_MS musí být kladné celé číslo nejvýše 2147483647.');
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.SPOOLMAN_API_KEY) {
      headers[process.env.SPOOLMAN_API_HEADER ?? 'X-API-Key'] = process.env.SPOOLMAN_API_KEY;
    }
    const response = await fetch(this.url.replace(/\/$/, '') + '/api/v1' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`Spoolman: HTTP ${response.status} při ${method} ${path.split('?')[0]}.`);
    return response.status === 204 ? null : response.json();
  }

  async list<T>(path: string): Promise<T[]> {
    const output: T[] = [];
    for (let offset = 0; offset < 100000; offset += 500) {
      const rows = await this.request(`${path}${path.includes('?') ? '&' : '?'}limit=500&offset=${offset}`);
      if (!Array.isArray(rows)) throw new Error('Neočekávaná odpověď Spoolmanu.');
      output.push(...rows);
      if (rows.length < 500) return output;
    }
    throw new Error('Příliš mnoho záznamů Spoolmanu.');
  }

  filaments() { return this.list<Filament>('/filament'); }
  spools() { return this.list<Spool>('/spool?allow_archived=true'); }

  async matches(data: ImportData) {
    const [filaments, spools] = await Promise.all([this.filaments(), this.spools()]);
    return {
      filaments: filaments.filter(filament => matchesFilament(filament, data)),
      existing: spools.filter(spool => duplicate(spool, data)),
    };
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation);
    this.tail = run.catch(() => {});
    return run;
  }

  commit(input: CommitInput): Promise<{ spool: Spool; existing: boolean; url?: string }> {
    return this.serialize(() => this.create(input));
  }

  private async ensureFields() {
    const definitions = await this.request('/field/spool');
    if (!Array.isArray(definitions)) throw new Error('Neočekávaná definice vlastních polí Spoolmanu.');
    // Validate every existing definition before creating any missing fields.
    for (const key of Object.keys(fields)) {
      const definition = definitions.find(field => field.key === key);
      if (definition && definition.field_type !== 'text') throw new Error(`Pole ${key} má nekompatibilní typ.`);
    }
    for (const [key, name] of Object.entries(fields)) {
      if (!definitions.some(field => field.key === key)) {
        await this.request('/field/spool/' + key, 'POST', { name, field_type: 'text' });
      }
    }
  }

  link(data: ImportData, spoolId: number) {
    return this.serialize(async () => {
      if (!Number.isSafeInteger(spoolId) || spoolId <= 0) throw new Error('Neplatné ID cívky.');
      const identifiers = identity(data);
      if (!Object.keys(identifiers).length) throw new Error('Chybí identifikátor cívky.');
      const known = uniqueSpool(await this.spools(), data);
      if (known && known.id !== spoolId) throw new Error('Identifikátor je již přiřazen jiné cívce.');
      const spool: Spool = await this.request('/spool/' + spoolId);
      for (const [key, value] of Object.entries(identifiers)) {
        if (spool.extra?.[key] && extraValue(spool, key) !== value) {
          throw new Error('Cívka již má jiný identifikátor.');
        }
      }
      await this.ensureFields();
      const updated = await this.request('/spool/' + spoolId, 'PATCH', {
        extra: { ...spool.extra, ...this.encodedIdentity(data) },
      });
      return this.result(updated, true);
    });
  }

  private encodedIdentity(data: ImportData) {
    return Object.fromEntries(Object.entries(identity(data)).map(([key, value]) => [key, JSON.stringify(value)]));
  }

  private result(spool: Spool, existing: boolean) {
    return {
      spool,
      existing,
      url: (process.env.SPOOLMAN_PUBLIC_URL || this.url).replace(/\/$/, '') + '/spool/show/' + spool.id,
    };
  }

  private async create(input: CommitInput) {
    const data = input.data;
    const full = remainingWeight(input);
    if (!Object.keys(identity(data)).length) throw new Error('Chybí identifikátor cívky; použijte QR s ID nebo NFC s UID.');
    const known = uniqueSpool(await this.spools(), data);
    if (known) return this.result(known, true);

    let filament: Filament | undefined;
    if (input.filamentId !== undefined) {
      if (!Number.isSafeInteger(input.filamentId) || input.filamentId <= 0) throw new Error('Neplatné ID filamentu.');
      filament = await this.request('/filament/' + input.filamentId);
    } else {
      const matches = (await this.filaments()).filter(candidate => matchesFilament(candidate, data));
      if (matches.length > 1) throw new Error('Vyberte konkrétní filament z nalezených shod.');
      filament = matches[0];
      if (!filament && (!data.density || !Number.isFinite(data.density) || data.density <= 0)) {
        throw new Error('Pro nový filament doplňte hustotu.');
      }
    }

    await this.ensureFields();
    if (!filament) {
      const vendors = (await this.list<{ id: number; name: string }>('/vendor'))
        .filter(candidate => normalized(candidate.name) === normalized(data.brand));
      if (vendors.length > 1) throw new Error('Ve Spoolmanu existuje více výrobců stejného názvu. Vyberte existující filament.');
      const vendor = vendors[0] ?? await this.request('/vendor', 'POST', { name: data.brand });
      filament = await this.request('/filament', 'POST', {
        vendor_id: vendor.id, name: data.name, material: data.material,
        diameter: data.diameter, density: data.density, weight: data.nominalWeight ?? data.initialWeight,
        spool_weight: data.spoolWeight, color_hex: data.colorHex, article_number: data.productId,
        settings_extruder_temp: data.nozzleTemp, settings_bed_temp: data.bedTemp,
      });
    }

    const payload = {
      filament_id: filament!.id, initial_weight: full, spool_weight: data.spoolWeight,
      used_weight: full - input.remainingWeight, location: input.location,
      comment: [data.sourceUrl, input.comment].filter(Boolean).join('\n'),
      extra: this.encodedIdentity(data), archived: false,
    };
    try {
      return this.result(await this.request('/spool', 'POST', payload), false);
    } catch (error) {
      // A lost response does not imply the POST failed. Reconcile before allowing
      // a retry; do not silently choose one of several matching spools.
      let found: Spool | undefined;
      try {
        found = uniqueSpool(await this.spools(), data);
      } catch (reconciliationError) {
        throw new Error('Výsledek zápisu nelze potvrdit. Zkontrolujte Spoolman. ' + (reconciliationError as Error).message);
      }
      if (found) return this.result(found, true);
      throw new Error('Výsledek zápisu nelze potvrdit. Před dalším pokusem ověřte cívku ve Spoolmanu. ' + (error as Error).message);
    }
  }
}
