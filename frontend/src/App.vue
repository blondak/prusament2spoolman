<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { QrcodeStream } from 'vue-qrcode-reader';
import { translateMessage } from '../../shared/messages';
import { readLocale, saveLocale, translate, type MessageKey } from './i18n';
import type { CommitInput, Filament, Preview, Spool } from '../../shared/types';

type NdefRecord = { mediaType?: string; recordType: string; data?: DataView };
type NdefReader = { scan: (options?: { signal?: AbortSignal }) => Promise<void>; onreading: ((event: { serialNumber?: string; message: { records: NdefRecord[] } }) => void) | null; onreadingerror: (() => void) | null };
type NdefConstructor = new () => NdefReader;
function storage(): Storage | undefined { try { return window.localStorage; } catch { return undefined; } }
const locale = ref(readLocale(storage()));
const t = (key: MessageKey) => translate(locale.value, key);
watch(locale, value => { saveLocale(value, storage()); document.documentElement.lang = value; document.title = value === 'cs' ? 'Import cívek | Prusament → Spoolman' : 'Spool import | Prusament → Spoolman'; }, { immediate: true });
const staticDemo = (window as Window & { __PRUSAMENT_STATIC_DEMO__?: boolean }).__PRUSAMENT_STATIC_DEMO__ === true;
const phase = ref<'scan'|'review'|'success'>('scan');
const mode = ref<'none'|'camera'|'nfc'>('none');
const busy = ref(false);
const error = ref('');
let errorRenderer: (() => string) | undefined;
function setLocalError(key: MessageKey) { setDynamicError(() => t(key)); }
function setDynamicError(render: () => string) { errorRenderer = render; error.value = render(); }
watch(locale, () => { if (errorRenderer && error.value) error.value = errorRenderer(); });
watch(error, value => { if (!value) errorRenderer = undefined; }, { flush: 'sync' });
const manual = ref('');
const preview = ref<Preview | null>(null);
const selected = ref<number | 'new'>('new');
const search = ref('');
const spoolSearch = ref('');
const spoolResults = ref<Spool[]>([]);
const linkSpoolId = ref<number | null>(null);
const results = ref<Filament[]>([]);
const weightMode = ref<'new'|'remaining'|'gross'>('new');
const remaining = ref<number | null>(null);
const gross = ref<number | null>(null);
const tare = ref<number | null>(null);
const location = ref('');
const comment = ref('');
const success = ref<{ id: number; existing: boolean; url?: string } | null>(null);
const status = ref<{connected:boolean; message?:string; demo:boolean} | null>(null);
let nfcAbort: AbortController | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let spoolSearchTimer: ReturnType<typeof setTimeout> | undefined;
let spoolSearchSequence = 0;
let searchSequence = 0;
const nfcAvailable = computed(() => 'NDEFReader' in window);
const actualWeight = computed(() => weightMode.value === 'new' ? (preview.value?.data.initialWeight ?? preview.value?.data.nominalWeight ?? null) : weightMode.value === 'gross' ? (gross.value != null && tare.value != null ? gross.value - tare.value : null) : remaining.value);
const validWeight = computed(() => actualWeight.value != null && Number.isFinite(actualWeight.value) && actualWeight.value >= 0 && (weightMode.value !== 'gross' || (gross.value != null && tare.value != null && gross.value >= 0 && tare.value >= 0)));
const color = computed(() => {
 const hex = preview.value?.data.colorHex?.replace(/^#/, '');
 return hex && /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : '#e86a2a';
});
const filamentLabel = (f: Filament) => [f.vendor?.name, f.name, f.material].filter(Boolean).join(' · ') || `Filament #${f.id}`;
function stopReaders() { mode.value = 'none'; nfcAbort?.abort(); nfcAbort = undefined; }
function reset() { stopReaders(); phase.value = 'scan'; preview.value = null; success.value = null; manual.value = ''; error.value = ''; search.value = ''; spoolSearch.value = ''; spoolResults.value = []; linkSpoolId.value = null; location.value = ''; comment.value = ''; weightMode.value = 'new'; remaining.value = null; gross.value = null; tare.value = null; }
async function api<T>(url: string, body?: unknown): Promise<T> {
 const response = await fetch(url, body === undefined ? { headers: { 'Accept-Language': locale.value } } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': locale.value }, body: JSON.stringify(body) });
 let payload: any;
 try { payload = await response.json(); } catch { payload = {}; }
 if (!response.ok) throw new Error(payload.error || payload.message || `${t('Požadavek se nezdařil')} (${response.status}).`);
 return payload as T;
}
async function loadPreview(body: unknown) {
 if (busy.value) return;
 busy.value = true; error.value = ''; stopReaders();
 try {
  const result = await api<Preview>('/api/import/preview', body);
  preview.value = result; selected.value = 'new'; results.value = result.filaments;
  tare.value = result.data.spoolWeight ?? null;
  remaining.value = result.data.remainingWeight ?? result.data.initialWeight ?? result.data.nominalWeight ?? null;
  weightMode.value = result.data.remainingWeight != null ? 'remaining' : (result.data.initialWeight ?? result.data.nominalWeight) != null ? 'new' : 'remaining';
  phase.value = 'review'; window.scrollTo({ top: 0, behavior: 'smooth' });
 } catch (e) { e instanceof Error ? error.value = e.message : setLocalError('Štítek se nepodařilo načíst.'); }
 finally { busy.value = false; }
}
function detect(codes: { rawValue: string }[]) { if (codes[0]?.rawValue) void loadPreview({ input: codes[0].rawValue }); }
function cameraError(e: Error) { stopReaders(); setDynamicError(() => `${t('Kameru se nepodařilo spustit')}: ${e.message}. ${t('Zkontrolujte oprávnění a zabezpečené připojení.')}`); }
function toBase64(data?: DataView) {
 if (!data) return '';
 const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
 let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
 return btoa(binary);
}
async function startNfc() {
 stopReaders(); error.value = '';
 const Reader = (window as unknown as { NDEFReader?: NdefConstructor }).NDEFReader;
 if (!Reader) { setLocalError('Web NFC není v tomto prohlížeči dostupné. Použijte QR kód nebo ruční zadání.'); return; }
 try {
  nfcAbort = new AbortController(); const reader = new Reader(); mode.value = 'nfc';
  reader.onreading = event => {
   const records = event.message.records.map(record => ({ mediaType: record.mediaType || record.recordType, data: toBase64(record.data) }));
   void loadPreview({ records, uid: event.serialNumber || undefined });
  };
  reader.onreadingerror = () => { setLocalError('NFC štítek se nepodařilo přečíst. Přiložte telefon znovu.'); };
  await reader.scan({ signal: nfcAbort.signal });
 } catch (e) { if ((e as Error).name !== 'AbortError') { stopReaders(); setDynamicError(() => `${t('NFC se nepodařilo spustit')}: ${(e as Error).message}`); } }
}
async function submit() {
 if (!preview.value || !validWeight.value || actualWeight.value == null || busy.value) return;
 busy.value = true; error.value = '';
 const body: CommitInput = { data: preview.value.data, remainingWeight: actualWeight.value, location: location.value.trim() || undefined, comment: comment.value.trim() || undefined };
 if (selected.value !== 'new') body.filamentId = selected.value;
 try {
  const result = await api<{spool:{id:number};existing:boolean;url?:string}>('/api/import/commit', body);
  success.value = { id: result.spool.id, existing: result.existing, url: result.url }; phase.value = 'success'; window.scrollTo({ top: 0, behavior: 'smooth' });
 } catch (e) { e instanceof Error ? error.value = e.message : setLocalError('Cívku se nepodařilo uložit.'); }
 finally { busy.value = false; }
}
async function linkExisting() {
 if (!preview.value || linkSpoolId.value == null || busy.value) return;
 busy.value = true; error.value = '';
 try {
  const result = await api<{spool:{id:number};existing:boolean;url?:string}>('/api/import/link', { data: preview.value.data, spoolId: linkSpoolId.value });
  success.value = { id: result.spool.id, existing: result.existing, url: result.url }; phase.value = 'success'; window.scrollTo({ top: 0, behavior: 'smooth' });
 } catch (e) { e instanceof Error ? error.value = e.message : setLocalError('Cívku se nepodařilo propojit.'); }
 finally { busy.value = false; }
}
watch(spoolSearch, value => {
 clearTimeout(spoolSearchTimer); const sequence = ++spoolSearchSequence; linkSpoolId.value = null;
 if (!value.trim()) { spoolResults.value = []; return; }
 spoolSearchTimer = setTimeout(async () => { try { const found = await api<Spool[]>(`/api/spools?q=${encodeURIComponent(value.trim())}`); if (sequence === spoolSearchSequence) spoolResults.value = found; } catch { if (sequence === spoolSearchSequence) setLocalError('Cívky se nepodařilo vyhledat.'); } }, 300);
});
watch(search, value => {
 clearTimeout(searchTimer); const sequence = ++searchSequence;
 if (!value.trim()) { results.value = preview.value?.filaments ?? []; return; }
 searchTimer = setTimeout(async () => { try { const found = await api<Filament[]>(`/api/filaments?q=${encodeURIComponent(value.trim())}`); if (sequence === searchSequence) results.value = found; } catch { if (sequence === searchSequence) setLocalError('Filamenty se nepodařilo vyhledat.'); } }, 300);
});
onMounted(async () => { try { status.value = await api('/api/status'); } catch { status.value = { connected: false, message: 'Server není dostupný', demo: false }; } });
onBeforeUnmount(() => { stopReaders(); clearTimeout(searchTimer); clearTimeout(spoolSearchTimer); });
</script>

<template>
 <div class="app-shell">
  <header class="topbar"><a class="brand" href="/" @click.prevent="reset"><span class="brand-mark">P<span>↗</span></span><span>PRUSAMENT <i>→</i> SPOOLMAN<small>{{ t("RYCHLÝ IMPORT CÍVEK") }}</small></span></a><div class="header-controls"><span class="status" :class="{ online: status?.connected }"><span></span>{{ status?.demo ? 'DEMO' : status?.connected ? t("PŘIPOJENO") : status ? 'OFFLINE' : t("PŘIPOJUJI") }}</span><div class="language-switch" role="group" :aria-label="t('Jazyk')"><button type="button" :aria-pressed="locale === 'en'" @click="locale = 'en'">EN</button><button type="button" :aria-pressed="locale === 'cs'" @click="locale = 'cs'">CZ</button></div></div></header>
  <main>
   <div v-if="staticDemo" class="notice" role="note"><strong>{{ t("Interaktivní demo") }}</strong>{{ t(" — vzorová data bez připojení ke Spoolmanu. Kamera a NFC jsou dostupné v plné aplikaci.") }}</div>
   <div class="eyebrow"><span class="eyebrow-line"></span> {{ phase === 'scan' ? t("01 / NAČTENÍ ŠTÍTKU") : phase === 'review' ? t("02 / KONTROLA A ULOŽENÍ") : t("HOTOVO") }}</div>
   <template v-if="phase === 'scan'">
    <section class="hero"><div><h1>{{ t("Cívka má svůj") }}<br><em>{{ t("příběh.") }}</em></h1><p>{{ t("Načtěte štítek Prusamentu a přeneste cívku do svého Spoolmanu. Všechno důležité na jednom místě.") }}</p></div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="spool"><div class="spool-inner"><span>P</span></div></div><span class="art-spark">✳</span><span class="art-label">READY TO PRINT<br>● ● ●</span></div></section>
    <section class="scan-card"><div class="card-heading"><div><span class="kicker">{{ t("ZAČNĚTE TADY") }}</span><h2>{{ t("Načíst štítek") }}</h2></div><span class="step-badge">01</span></div><p class="muted">{{ t("Vyberte způsob, který vám vyhovuje.") }}</p>
     <div v-if="mode === 'camera'" class="reader"><QrcodeStream @detect="detect" @error="cameraError" /><div class="viewfinder"></div><p>{{ t("Namiřte fotoaparát na QR kód") }}</p><button class="reader-close" type="button" @click="stopReaders">{{ t("Zavřít kameru ×") }}</button></div>
     <div v-else-if="mode === 'nfc'" class="nfc-reader"><div class="nfc-pulse">◉</div><strong>{{ t("Přiložte telefon ke štítku") }}</strong><p>{{ t("Čekáme na načtení NFC…") }}</p><button class="text-button" type="button" @click="stopReaders">{{ t("Zrušit") }}</button></div>
     <div v-else class="scan-actions"><button class="scan-option primary-option" type="button" :disabled="busy || staticDemo" @click="error = ''; mode = 'camera'"><span class="option-icon">▦</span><span><strong>{{ t("Načíst QR kód") }}</strong><small>{{ t("Fotoaparátem telefonu") }}</small></span><span class="arrow">↗</span></button><button class="scan-option" type="button" :disabled="busy || staticDemo" @click="startNfc"><span class="option-icon nfc-icon">)))</span><span><strong>{{ t("Načíst NFC") }}</strong><small>{{ nfcAvailable ? t("Přiložením telefonu") : t("Android · podporovaný prohlížeč") }}</small></span><span class="arrow">↗</span></button></div>
     <div v-if="!staticDemo" class="divider"><span>{{ t("NEBO ZADEJTE RUČNĚ") }}</span></div><form v-if="!staticDemo" class="manual-form" @submit.prevent="loadPreview({ input: manual.trim() })"><label for="manual">{{ t("Odkaz nebo ID Prusamentu") }}</label><div class="input-action"><input id="manual" v-model="manual" :placeholder="t('Vložte odkaz nebo ID')" autocomplete="off"><button type="submit" :disabled="!manual.trim() || busy" :aria-label="t('Načíst zadaný odkaz')">→</button></div></form><p v-if="status?.demo" class="demo-hint">{{ t("Demo režim: pro ukázku zadejte ") }}<button class="text-button" @click="loadPreview({ input: 'demo' })">{{ staticDemo ? t("Vyzkoušet demo →") : 'demo →' }}</button></p>
    </section>
    <div class="footnote"><span>✳</span><p>{{ t("QR kód najdete na cívce nebo jejím obalu.") }}<br>{{ t("NFC je dostupné v podporovaných prohlížečích na Androidu.") }}</p></div>
   </template>
   <template v-else-if="phase === 'review' && preview">
    <div class="page-title"><div><h1>{{ t("Je to tahle ") }}<em>{{ t("cívka?") }}</em></h1><p>{{ t("Zkontrolujte údaje a doplňte, co potřebujete.") }}</p></div><button class="back-button" @click="reset">{{ t("← Zpět") }}</button></div>
    <section class="product-card"><div class="color-swatch" :style="{ '--filament-color': color }"><div class="mini-spool"></div></div><div class="product-info"><span class="kicker">{{ preview.data.brand || 'PRUSAMENT' }} · {{ preview.data.material || 'FILAMENT' }}</span><h2>{{ preview.data.name || t("Načtená cívka") }}</h2><p>{{ preview.data.diameter }} mm <template v-if="preview.data.nominalWeight"> · {{ preview.data.nominalWeight }} g</template><template v-if="preview.data.prusamentId"> · ID {{ preview.data.prusamentId }}</template></p></div><span class="verified">✓</span></section>
    <div v-for="warning in preview.data.warnings" :key="warning" class="notice">⚑ &nbsp;{{ translateMessage(warning, locale) }}</div>
    <div v-if="preview.existing.length" class="notice duplicate"><strong>{{ t("⚑ Tuto cívku už možná máte.") }}</strong><p>{{ t('Ve Spoolmanu jsme našli') }} {{ preview.existing.length }} {{ t(preview.existing.length === 1 ? 'odpovídající záznam' : 'odpovídající záznamy') }}: <span v-for="spool in preview.existing" :key="spool.id" class="spool-id">#{{ spool.id }} {{ spool.filament?.name }}</span></p></div>
    <details class="details-edit"><summary>{{ t("Upravit údaje ze štítku") }} <span>＋</span></summary><div class="edit-fields"><div><label for="brand">{{ t("Značka") }}</label><input id="brand" v-model="preview.data.brand"></div><div><label for="name">{{ t("Název") }}</label><input id="name" v-model="preview.data.name"></div><div><label for="material">{{ t("Materiál") }}</label><input id="material" v-model="preview.data.material"></div><div><label for="diameter">{{ t("Průměr (mm)") }}</label><input id="diameter" v-model.number="preview.data.diameter" type="number" min="0.01" step="any"></div><div><label for="color">{{ t("Barva (hex)") }}</label><input id="color" v-model="preview.data.colorHex" :placeholder="t('např. FF6600')"></div><div><label for="density">{{ t("Hustota (g/cm³)") }}</label><input id="density" v-model.number="preview.data.density" type="number" min="0" step="any"></div><div><label for="initial">{{ t("Počáteční hmotnost filamentu (g)") }}</label><input id="initial" v-model.number="preview.data.initialWeight" type="number" min="0" step="any"></div><div><label for="spool-weight">{{ t("Hmotnost prázdné cívky (g)") }}</label><input id="spool-weight" v-model.number="preview.data.spoolWeight" type="number" min="0" step="any" @input="tare = preview.data.spoolWeight ?? null"></div><div><label for="nozzle">{{ t("Teplota trysky (°C)") }}</label><input id="nozzle" v-model.number="preview.data.nozzleTemp" type="number" min="0" step="any"></div><div><label for="bed">{{ t("Teplota podložky (°C)") }}</label><input id="bed" v-model.number="preview.data.bedTemp" type="number" min="0" step="any"></div></div></details>
    <section class="form-section"><div class="section-heading"><span>01</span><div><h2>Filament</h2><p>{{ t("Vyberte existující, nebo založte nový.") }}</p></div></div><label for="filament-search">{{ t("Vyhledat ve Spoolmanu") }}</label><input id="filament-search" v-model="search" :placeholder="t('Název, materiál…')"><div class="choices"><label v-for="filament in results" :key="filament.id" class="choice" :class="{ selected: selected === filament.id }"><input v-model="selected" type="radio" :value="filament.id"><span class="choice-copy"><strong>{{ filamentLabel(filament) }}</strong><small>Filament #{{ filament.id }}</small></span></label><label class="choice" :class="{ selected: selected === 'new' }"><input v-model="selected" type="radio" value="new"><span class="choice-copy"><strong>{{ t("Automaticky najít nebo vytvořit filament") }}</strong><small>{{ t("Použít údaje ze štítku") }}</small></span><span class="plus">+</span></label></div></section>
    <section class="form-section"><div class="section-heading"><span>02</span><div><h2>{{ t("Kolik zbývá?") }}</h2><p>{{ t("Hmotnost samotného filamentu bez cívky.") }}</p></div></div><div class="segmented"><button type="button" :class="{ active: weightMode === 'new' }" @click="weightMode = 'new'">{{ t("Nová cívka") }}</button><button type="button" :class="{ active: weightMode === 'remaining' }" @click="weightMode = 'remaining'">{{ t("Zbývá") }}</button><button type="button" :class="{ active: weightMode === 'gross' }" @click="weightMode = 'gross'">{{ t("Váha − cívka") }}</button></div><div v-if="weightMode === 'new'" class="weight-result"><span>{{ t("Počáteční hmotnost") }}</span><strong>{{ actualWeight ?? '—' }} <small>g</small></strong><p v-if="actualWeight == null">{{ t("Hmotnost na štítku chybí. Zvolte „Zbývá“ a zadejte ji ručně.") }}</p></div><div v-else-if="weightMode === 'remaining'"><label for="remaining">{{ t("Zbývající filament (g)") }}</label><input id="remaining" v-model.number="remaining" type="number" min="0" step="any" inputmode="decimal" :placeholder="t('např. 750')"></div><div v-else><div class="weight-grid"><div><label for="gross">{{ t("Celková váha (g)") }}</label><input id="gross" v-model.number="gross" type="number" min="0" step="any" inputmode="decimal" :placeholder="t('např. 950')"></div><div><label for="tare">{{ t("Prázdná cívka (g)") }}</label><input id="tare" v-model.number="tare" type="number" min="0" step="any" inputmode="decimal" :placeholder="t('např. 200')"></div></div><div class="calculation">{{ t("Zbývá") }} <strong>{{ actualWeight != null ? actualWeight : '—' }} g</strong></div></div><p v-if="!validWeight" class="field-error">{{ t("Zadejte platnou nezápornou hmotnost.") }}</p></section>
    <section class="form-section"><div class="section-heading"><span>03</span><div><h2>{{ t("Ještě drobnosti") }}</h2><p>{{ t("Nepovinné údaje pro váš přehled.") }}</p></div></div><label for="location">{{ t("Umístění") }}</label><input id="location" v-model="location" :placeholder="t('např. Dílna, police 2')"><label for="comment">{{ t("Poznámka") }}</label><textarea id="comment" v-model="comment" rows="3" :placeholder="t('Cokoliv si chcete zapamatovat')"></textarea></section>
    <details class="details-edit link-existing"><summary>{{ t("Propojit s existující cívkou") }} <span>＋</span></summary><div class="link-content"><p>{{ t("Máte tuto cívku ve Spoolmanu už založenou? Vyhledejte ji a propojte se štítkem.") }}</p><label for="spool-search">{{ t("Vyhledat cívku podle názvu nebo ID") }}</label><input id="spool-search" v-model="spoolSearch" :placeholder="t('Název nebo ID cívky')"><div v-if="spoolResults.length" class="choices"><label v-for="spool in spoolResults" :key="spool.id" class="choice" :class="{ selected: linkSpoolId === spool.id }"><input v-model="linkSpoolId" type="radio" :value="spool.id"><span class="choice-copy"><strong>#{{ spool.id }} · {{ filamentLabel(spool.filament) }}</strong><small v-if="spool.comment">{{ spool.comment }}</small></span></label></div><p v-else-if="spoolSearch.trim()">{{ t("Žádné cívky k výběru.") }}</p><button class="link-button" :disabled="linkSpoolId == null || busy" @click="linkExisting">{{ busy ? t("Propojuji…") : t("Propojit vybranou cívku") }} ↗</button></div></details>
    <div class="submit-area"><button class="submit-button" :disabled="busy || !validWeight" @click="submit">{{ busy ? t("Ukládám…") : t("Uložit do Spoolmanu") }} <span>↗</span></button><p>{{ t("Před uložením můžete vše upravit.") }}</p></div>
   </template>
   <template v-else-if="phase === 'success' && success"><section class="success-card"><div class="success-icon">✓</div><span class="kicker">{{ success.existing ? t("UŽ JE NA SVÉM MÍSTĚ") : t("PŘIPRAVENO K TISKU") }}</span><h1>{{ status?.demo ? t("Demo je hotové.") : success.existing ? t("Cívku už máte.") : t("Cívka je doma.") }}</h1><p>{{ status?.demo ? t("Demo režim: akce byla pouze simulována, ve Spoolmanu se nic neuložilo.") : success.existing ? t("Tato cívka je ve Spoolmanu dostupná.") : t("Cívka byla úspěšně uložena do Spoolmanu.") }}</p><div class="success-number">SPOOLMAN <strong>#{{ success.id }}</strong></div><a v-if="success.url" class="submit-button" :href="success.url" target="_blank" rel="noopener noreferrer">{{ t("Otevřít ve Spoolmanu") }} <span>↗</span></a><button class="secondary-button" @click="reset">{{ t("Načíst další cívku →") }}</button></section></template>
   <div v-if="error" class="error-banner" role="alert"><span>!</span><p>{{ translateMessage(error, locale) }}</p><button @click="error = ''" :aria-label="t('Zavřít')">×</button></div>
  </main><footer><span>PRUSAMENT <i>→</i> SPOOLMAN</span><span>{{ t("MADE FOR MAKING ✳") }}</span></footer>
 </div>
</template>
