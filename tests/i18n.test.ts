import test from 'node:test';
import assert from 'node:assert/strict';
import { dictionaries, LOCALE_KEY, readLocale, saveLocale, translate } from '../frontend/src/i18n';

test('locale defaults to English and accepts only stored Czech', () => {
 assert.equal(readLocale(), 'en');
 for (const value of [null, 'en', 'cz', 'fr', '']) assert.equal(readLocale({ getItem: () => value }), 'en');
 assert.equal(readLocale({ getItem: key => key === LOCALE_KEY ? 'cs' : null }), 'cs');
});
test('storage failures are safe and changes use the documented key', () => {
 assert.equal(readLocale({ getItem: () => { throw new Error('blocked'); } }), 'en');
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
