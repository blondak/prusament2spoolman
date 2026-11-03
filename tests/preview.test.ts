import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore The self-contained preview bridge is deliberately plain JavaScript.
import {installPreview} from '../scripts/preview-runtime.mjs';

test('static preview works under a GitHub Pages project path with no external requests',async()=>{
 const target:any={location:{href:'https://blondak.github.io/prusament2spoolman/'}};
 installPreview(target);
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
