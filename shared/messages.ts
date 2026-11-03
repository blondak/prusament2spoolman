export type Locale = 'en' | 'cs';

// Resolve supported language ranges in preference order; English is the default.
export function resolveLocale(header?: string): Locale {
  const languages = (header ?? '').split(',').map((part, index) => {
    const [language, ...parameters] = part.trim().toLowerCase().split(';');
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    const q = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return {language: language.split('-')[0], q, index};
  }).filter(({q}) => Number.isFinite(q) && q > 0 && q <= 1)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const {language} of languages) if (language === 'en' || language === 'cs') return language;
  return 'en';
}

const messages: [string, string][] = [
  ['Zkontrolujte vyplněné údaje.', 'Check the entered details.'],
  ['Neočekávaná chyba serveru.', 'Unexpected server error.'],
  ['Nepovolený původ požadavku.', 'Request origin is not allowed.'],
  ['Endpoint neexistuje.', 'Endpoint not found.'],
  ['Ukázková data. V demo režimu se do Spoolmanu nezapisuje.', 'Sample data. Demo mode does not write to Spoolman.'],
  ['Veřejná ukázka: smyšlená data, žádné spojení se Spoolmanem.', 'Public demo: fictional data, no connection to Spoolman.'],
  ['Ukázka nepovoluje externí požadavky.', 'The demo does not allow external requests.'],
  ['Tato ukázka používá pouze vzorová data. Zvolte „Vyzkoušet demo“.', 'This demo only uses sample data. Select “Try the demo”.'],
  ['Zkontrolujte počáteční a zbývající hmotnost.', 'Check the initial and remaining weight.'],
  ['Ukázková cívka neexistuje.', 'Demo spool not found.'],
  ['Tato ukázka nekomunikuje se serverem.', 'This demo does not communicate with a server.'],
  ['Zadejte platnou adresu Prusament.', 'Enter a valid Prusament URL.'],
  ['Neplatná adresa Prusament.', 'Invalid Prusament URL.'],
  ['Povoleny jsou pouze adresy prusa.io a prusament.com se standardním portem a bez přihlašovacích údajů.', 'Only prusa.io and prusament.com URLs with a standard port and no credentials are allowed.'],
  ['Adresa serveru není veřejná.', 'The server address is not public.'],
  ['Stránka je příliš velká.', 'The page is too large.'],
  ['Neplatné nebo příliš dlouhé přesměrování.', 'Invalid or too many redirects.'],
  ['Nepodařilo se načíst stránku.', 'Could not load the page.'],
  ['Poškozená data spoolData.', 'Corrupt spoolData.'],
  ['Neukončená data spoolData.', 'Unterminated spoolData.'],
  ['Na stránce nejsou údaje konkrétní cívky (spoolData).', 'The page does not contain data for a specific spool (spoolData).'],
  ['Nepodporovaný formát dat spoolData.', 'Unsupported spoolData format.'],
  ['Data cívky na stránce jsou poškozená.', 'The spool data on the page is corrupt.'],
  ['Na stránce chybí název filamentu.', 'The page is missing the filament name.'],
  ['Materiál nebyl rozpoznán; doplňte jej.', 'The material was not recognized; enter it manually.'],
  ['Hmotnost z QR je výrobní údaj; ověřte, že jde o čistou hmotnost filamentu. Hmotnost prázdné cívky se automaticky neodečítá.', 'The QR weight is a manufacturing value; verify that it is the net filament weight. The empty spool weight is not subtracted automatically.'],
  ['Průměr nebyl uveden; použito 1,75 mm.', 'No diameter was specified; using 1.75 mm.'],
  ['Hustota je vypočtena z výrobní hmotnosti, délky a průměru; ověřte tyto údaje.', 'Density is calculated from the manufacturing weight, length and diameter; verify these values.'],
  ['Hustota je odhad podle typu materiálu; v případě potřeby ji upravte.', 'Density is estimated from the material type; adjust it if needed.'],
  ['Hustota nebyla zjištěna; doplňte ji podle výrobce.', 'Density could not be determined; enter the manufacturer’s value.'],
  ['Poškozená nebo příliš dlouhá sekce CBOR.', 'Corrupt or oversized CBOR section.'],
  ['CBOR obsahuje příliš hluboké vnoření.', 'CBOR nesting is too deep.'],
  ['Neplatný formát CBOR.', 'Invalid CBOR format.'],
  ['Neplatná délka CBOR.', 'Invalid CBOR length.'],
  ['Neočekávaný konec CBOR.', 'Unexpected end of CBOR.'],
  ['Neplatný neurčitý CBOR typ.', 'Invalid indefinite CBOR type.'],
  ['Neplatný řetězec CBOR.', 'Invalid CBOR string.'],
  ['Neplatné UTF-8 v NFC tagu.', 'Invalid UTF-8 in the NFC tag.'],
  ['Příliš mnoho položek CBOR.', 'Too many CBOR items.'],
  ['Duplicitní klíč CBOR.', 'Duplicate CBOR key.'],
  ['Neplatná data CBOR.', 'Invalid CBOR data.'],
  ['Sekce OpenPrintTag musí být mapa s celočíselnými klíči.', 'The OpenPrintTag section must be a map with integer keys.'],
  ['Neplatná velikost NFC dat.', 'Invalid NFC data size.'],
  ['Neplatný offset nebo velikost NFC regionu.', 'Invalid NFC region offset or size.'],
  ['NFC regiony se překrývají nebo leží mimo data.', 'NFC regions overlap or extend beyond the data.'],
  ['NFC region nemá offset.', 'The NFC region has no offset.'],
  ['NFC tag neobsahuje FFF filament.', 'The NFC tag does not contain FFF filament.'],
  ['Neplatný typ materiálu v NFC tagu.', 'Invalid material type in the NFC tag.'],
  ['Typ materiálu není znám; doplňte jej ručně.', 'The material type is unknown; enter it manually.'],
  ['NFC tag nemá úplný název výrobce a materiálu.', 'The NFC tag is missing the full manufacturer and material name.'],
  ['Neplatná spotřebovaná hmotnost NFC tagu.', 'Invalid consumed weight in the NFC tag.'],
  ['Tag neuvádí spotřebu. U použité cívky upravte zbývající hmotnost.', 'The tag does not specify consumption. Adjust the remaining weight for a used spool.'],
  ['Neplatná barva v NFC tagu.', 'Invalid color in the NFC tag.'],
  ['Neplatné UUID v NFC tagu.', 'Invalid UUID in the NFC tag.'],
  ['Neplatné UID NFC tagu.', 'Invalid NFC tag UID.'],
  ['NFC musí obsahovat právě jeden záznam OpenPrintTag.', 'NFC must contain exactly one OpenPrintTag record.'],
  ['Neplatná Base64 data NFC.', 'Invalid Base64 NFC data.'],
  ['Načtěte QR kód nebo NFC tag.', 'Scan a QR code or NFC tag.'],
  ['Identifikátor odpovídá více cívkám. Zkontrolujte duplicity ve Spoolmanu.', 'The identifier matches multiple spools. Check for duplicates in Spoolman.'],
  ['Doplňte platnou plnou hmotnost a nezápornou zbývající hmotnost, která ji nepřekračuje.', 'Enter a valid full weight and a nonnegative remaining weight that does not exceed it.'],
  ['Není nastaven SPOOLMAN_URL.', 'SPOOLMAN_URL is not configured.'],
  ['REQUEST_TIMEOUT_MS musí být kladné celé číslo nejvýše 2147483647.', 'REQUEST_TIMEOUT_MS must be a positive integer no greater than 2147483647.'],
  ['Neočekávaná odpověď Spoolmanu.', 'Unexpected Spoolman response.'],
  ['Příliš mnoho záznamů Spoolmanu.', 'Too many Spoolman records.'],
  ['Neočekávaná definice vlastních polí Spoolmanu.', 'Unexpected Spoolman custom field definition.'],
  ['Neplatné ID cívky.', 'Invalid spool ID.'],
  ['Chybí identifikátor cívky.', 'Missing spool identifier.'],
  ['Identifikátor je již přiřazen jiné cívce.', 'The identifier is already assigned to another spool.'],
  ['Cívka již má jiný identifikátor.', 'The spool already has a different identifier.'],
  ['Chybí identifikátor cívky; použijte QR s ID nebo NFC s UID.', 'Missing spool identifier; use a QR code with an ID or NFC with a UID.'],
  ['Neplatné ID filamentu.', 'Invalid filament ID.'],
  ['Vyberte konkrétní filament z nalezených shod.', 'Select a specific filament from the matches.'],
  ['Pro nový filament doplňte hustotu.', 'Enter the density for the new filament.'],
  ['Ve Spoolmanu existuje více výrobců stejného názvu. Vyberte existující filament.', 'Spoolman contains multiple manufacturers with the same name. Select an existing filament.'],
];

// Translate only application messages. Product names and unknown upstream errors
// stay untouched. Both directions support changing language after a response.
export function translateMessage(message: string, locale: Locale): string {
  for (const [cs, en] of messages) if (message === cs || message === en) return locale === 'cs' ? cs : en;
  const templates: [RegExp, RegExp, string, string][] = [
    [/^Prusament vrátil chybu HTTP (\d+)\.$/, /^Prusament returned HTTP error (\d+)\.$/, 'Prusament vrátil chybu HTTP $1.', 'Prusament returned HTTP error $1.'],
    [/^Neplatná číselná hodnota NFC pole (\d+)\.$/, /^Invalid numeric value in NFC field (\d+)\.$/, 'Neplatná číselná hodnota NFC pole $1.', 'Invalid numeric value in NFC field $1.'],
    [/^Neplatný text NFC pole (\d+)\.$/, /^Invalid text in NFC field (\d+)\.$/, 'Neplatný text NFC pole $1.', 'Invalid text in NFC field $1.'],
    [/^Pole (.+) má nekompatibilní typ\.$/, /^Field (.+) has an incompatible type\.$/, 'Pole $1 má nekompatibilní typ.', 'Field $1 has an incompatible type.'],
    [/^Spoolman: HTTP (\d+) při (\S+) (.+)\.$/, /^Spoolman: HTTP (\d+) during (\S+) (.+)\.$/, 'Spoolman: HTTP $1 při $2 $3.', 'Spoolman: HTTP $1 during $2 $3.'],
  ];
  for (const [cs, en, csTemplate, enTemplate] of templates) {
    const pattern = cs.test(message) ? cs : en.test(message) ? en : undefined;
    if (pattern) return message.replace(pattern, locale === 'cs' ? csTemplate : enTemplate);
  }
  const prefixes = [
    ['Výsledek zápisu nelze potvrdit. Zkontrolujte Spoolman. ', 'The write result could not be confirmed. Check Spoolman. '],
    ['Výsledek zápisu nelze potvrdit. Před dalším pokusem ověřte cívku ve Spoolmanu. ', 'The write result could not be confirmed. Verify the spool in Spoolman before trying again. '],
  ];
  for (const [cs, en] of prefixes) {
    const prefix = message.startsWith(cs) ? cs : message.startsWith(en) ? en : undefined;
    if (prefix) return (locale === 'cs' ? cs : en) + translateMessage(message.slice(prefix.length), locale);
  }
  return message;
}
