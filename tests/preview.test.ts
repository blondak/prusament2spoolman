import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore The self-contained preview bridge is deliberately plain JavaScript.
import {installPreview} from '../scripts/preview-runtime.mjs';
import {translateMessage,resolveLocale} from '../shared/messages.ts';

test('static preview works under a GitHub Pages project path with no external requests',async()=>{
 const target:any={location:{href:'https://blondak.github.io/prusament2spoolman/'}};
 installPreview(target,translateMessage,resolveLocale);
 assert.equal(target.__PRUSAMENT_STATIC_DEMO__,true);
 const post=(url:string,body:unknown)=>target.fetch(url,{body:JSON.stringify(body)});
 assert.equal((await target.fetch('/api/status')).status,200);
 assert.equal((await post('/api/import/preview',{input:'https://prusa.io/s/real'})).status,400);
 const data=(await (await post('/api/import/preview',{input:'demo'})).json()).data;
 assert.equal((await post('/api/import/commit',{data,remainingWeight:500})).status,200);
 assert.equal((await post('/api/import/commit',{data,remainingWeight:5000})).status,400);
 assert.equal((await post('/api/import/link',{data,spoolId:42})).status,200);
 await assert.rejects(target.fetch('https://spoolman.example/api/v1/spool'));
 const again=(await (await post('/api/import/preview',{input:'demo'})).json()).data;
 assert.equal(again.initialWeight,1024);
});


test('static preview localizes responses and supports switching languages',async()=>{
 const target:any={location:{href:'https://example.com/project/'}};
 installPreview(target,translateMessage,resolveLocale);
 const post=(body:unknown,language?:string)=>target.fetch('/api/import/preview',{body:JSON.stringify(body),headers:language?{'Accept-Language':language}:{}});
 const english=await post({input:'demo'});
 assert.equal(english.headers.get('Content-Language'),'en');
 assert.equal(english.headers.get('Vary'),'Accept-Language');
 const englishData=(await english.json()).data;
 assert.equal(englishData.warnings[0],'Public demo: fictional data, no connection to Spoolman.');
 const czech=await post({input:'demo'},'cs-CZ');
 assert.equal(czech.headers.get('Content-Language'),'cs');
 const czechData=(await czech.json()).data;
 assert.equal(czechData.warnings[0],'Veřejná ukázka: smyšlená data, žádné spojení se Spoolmanem.');
 assert.equal(czechData.name,englishData.name);
 assert.equal((await (await post({input:'other'},'cs')).json()).message,'Tato ukázka používá pouze vzorová data. Zvolte „Vyzkoušet demo“.');
 assert.equal((await post({input:'demo'},'de')).headers.get('Content-Language'),'en');
 await assert.rejects(target.fetch('https://external.example/',{headers:{'Accept-Language':'cs'}}),/Ukázka nepovoluje externí požadavky/);
});
