import test from 'node:test';
import assert from 'node:assert/strict';
import { dictionaries, LOCALE_KEY, readLocale, saveLocale, translate } from '../frontend/src/i18n';

test('locale follows browser preference order and falls back to English', () => {
 assert.equal(readLocale(), 'en');
 assert.equal(readLocale(undefined, ['cs-CZ', 'en-US']), 'cs');
 assert.equal(readLocale(undefined, ['en-GB', 'cs']), 'en');
 assert.equal(readLocale(undefined, ['de-DE', 'CS-cz', 'en']), 'cs');
 assert.equal(readLocale(undefined, ['fr', 'de']), 'en');
 for (const value of [null, 'cz', 'fr', '']) assert.equal(readLocale({ getItem: () => value }, ['cs-CZ']), 'cs');
});
test('saved manual choice takes precedence over browser language', () => {
 assert.equal(readLocale({ getItem: () => 'en' }, ['cs-CZ']), 'en');
 assert.equal(readLocale({ getItem: key => key === LOCALE_KEY ? 'cs' : null }, ['en-US']), 'cs');
});
test('storage failures are safe and changes use the documented key', () => {
 assert.equal(readLocale({ getItem: () => { throw new Error('blocked'); } }), 'en');
 assert.equal(readLocale({ getItem: () => { throw new Error('blocked'); } }, ['cs-CZ']), 'cs');
 assert.doesNotThrow(() => saveLocale('cs', { setItem: () => { throw new Error('blocked'); } }));
 let saved = '';
 saveLocale('cs', { setItem: (key, value) => { saved = `${key}=${value}`; } });
 assert.equal(saved, 'prusament.locale=cs');
});
test('dictionaries have equal keys and translate in both languages', () => {
 assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.cs).sort());
 assert.equal(translate('en', 'Načíst štítek'), 'Scan label');
 assert.equal(translate('cs', 'Načíst štítek'), 'Načíst štítek');
 assert.equal(translate('cs', 'missing' as never), 'missing');
});
