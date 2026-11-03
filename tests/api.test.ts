import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.ts';

test('demo HTTP workflow previews and simulates saving without network', async () => {
 const before=process.env.DEMO_MODE;process.env.DEMO_MODE='true';
 const app=await createApp();
 try {
  assert.equal((await app.inject('/api/health/ready')).statusCode,200);
  assert.deepEqual((await app.inject('/api/status')).json(),{connected:true,demo:true});
  const preview=await app.inject({method:'POST',url:'/api/import/preview',payload:{input:'demo'}});
  assert.equal(preview.statusCode,200);
  assert.equal(preview.headers['content-language'],'en');
  assert.equal(preview.headers.vary,'Accept-Language');
  const data=preview.json().data;
  assert.deepEqual(data.warnings,['Sample data. Demo mode does not write to Spoolman.']);
  const result=await app.inject({method:'POST',url:'/api/import/commit',payload:{data,remainingWeight:750}});
  assert.equal(result.statusCode,200);assert.equal(result.json().spool.id,123);
  const invalid=await app.inject({method:'POST',url:'/api/import/commit',payload:{data,remainingWeight:-1}});
  assert.equal(invalid.statusCode,400);
  assert.equal(invalid.json().message,'Check the entered details.');
  const forbidden=await app.inject({method:'POST',url:'/api/import/preview',headers:{origin:'https://untrusted.example'},payload:{input:'demo'}});
  assert.equal(forbidden.statusCode,403);
  assert.equal(forbidden.json().message,'Request origin is not allowed.');
 } finally {await app.close();if(before===undefined)delete process.env.DEMO_MODE;else process.env.DEMO_MODE=before;}
});

test('unconfigured production instance reports not ready',async()=>{
 const beforeDemo=process.env.DEMO_MODE,beforeUrl=process.env.SPOOLMAN_URL;
 delete process.env.DEMO_MODE;delete process.env.SPOOLMAN_URL;
 const app=await createApp();
 try {assert.equal((await app.inject('/api/health/ready')).statusCode,503);assert.equal((await app.inject('/api/status')).json().connected,false);assert.equal((await app.inject('/api/status')).json().message,'SPOOLMAN_URL is not configured.');}
 finally {await app.close();if(beforeDemo!==undefined)process.env.DEMO_MODE=beforeDemo;if(beforeUrl!==undefined)process.env.SPOOLMAN_URL=beforeUrl;}
});


test('API negotiates Czech, defaults to English and localizes domain errors',async()=>{
 const before=process.env.DEMO_MODE;process.env.DEMO_MODE='true';
 const app=await createApp();
 try {
  const preview=await app.inject({method:'POST',url:'/api/import/preview',headers:{'accept-language':'cs-CZ, en;q=0.7'},payload:{input:'demo'}});
  assert.equal(preview.headers['content-language'],'cs');
  assert.equal(preview.json().data.warnings[0],'Ukázková data. V demo režimu se do Spoolmanu nezapisuje.');
  assert.equal(preview.json().data.name,'PLA Galaxy Black');
  const error=await app.inject({method:'POST',url:'/api/import/preview',payload:{}});
  assert.equal(error.json().message,'Scan a QR code or NFC tag.');
  const czechError=await app.inject({method:'POST',url:'/api/import/preview',headers:{'accept-language':'cs'},payload:{}});
  assert.equal(czechError.json().message,'Načtěte QR kód nebo NFC tag.');
  const validation=await app.inject({method:'POST',url:'/api/import/commit',headers:{'accept-language':'cs'},payload:{}});
  assert.equal(validation.json().message,'Zkontrolujte vyplněné údaje.');
  const fallback=await app.inject({method:'POST',url:'/api/import/preview',headers:{'accept-language':'de-DE'},payload:{input:'demo'}});
  assert.equal(fallback.headers['content-language'],'en');
  assert.equal(fallback.json().data.warnings[0],'Sample data. Demo mode does not write to Spoolman.');
  const missing=await app.inject({url:'/api/missing',headers:{'accept-language':'cs'}});
  assert.equal(missing.statusCode,404);
  assert.equal(missing.json().message,'Endpoint neexistuje.');
 } finally {await app.close();if(before===undefined)delete process.env.DEMO_MODE;else process.env.DEMO_MODE=before;}
});
