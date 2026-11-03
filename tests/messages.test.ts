import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLocale,translateMessage} from '../shared/messages.ts';

test('locale negotiation honors quality, regions, exclusions and English fallback',()=>{
 for(const [header,expected] of [[undefined,'en'],['cs-CZ','cs'],['CS;q=0.8,en-US;q=0.9','en'],['de,cs;q=0.7','cs'],['cs;q=0,en;q=1','en'],['fr','en'],['cz','en'],['cs;q=invalid','en']] as const)assert.equal(resolveLocale(header),expected);
});

test('application message translation is reversible and preserves dynamic values',()=>{
 const examples=[
  ['Prusament vrátil chybu HTTP 503.','Prusament returned HTTP error 503.'],
  ['Neplatná číselná hodnota NFC pole 17.','Invalid numeric value in NFC field 17.'],
  ['Neplatný text NFC pole 11.','Invalid text in NFC field 11.'],
  ['Pole prusament_id má nekompatibilní typ.','Field prusament_id has an incompatible type.'],
  ['Spoolman: HTTP 404 při GET /spool/42.','Spoolman: HTTP 404 during GET /spool/42.'],
  ['Výsledek zápisu nelze potvrdit. Zkontrolujte Spoolman. Neočekávaná odpověď Spoolmanu.','The write result could not be confirmed. Check Spoolman. Unexpected Spoolman response.'],
  ['Výsledek zápisu nelze potvrdit. Před dalším pokusem ověřte cívku ve Spoolmanu. Spoolman: HTTP 502 při POST /spool.','The write result could not be confirmed. Verify the spool in Spoolman before trying again. Spoolman: HTTP 502 during POST /spool.'],
 ];
 for(const [cs,en] of examples){assert.equal(translateMessage(cs,'en'),en);assert.equal(translateMessage(en,'cs'),cs);}
 assert.equal(translateMessage('PLA Galaxy Black','cs'),'PLA Galaxy Black');
 assert.equal(translateMessage('fetch failed','cs'),'fetch failed');
});
