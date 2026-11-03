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
  const data=preview.json().data;
  const result=await app.inject({method:'POST',url:'/api/import/commit',payload:{data,remainingWeight:750}});
  assert.equal(result.statusCode,200);assert.equal(result.json().spool.id,123);
  const invalid=await app.inject({method:'POST',url:'/api/import/commit',payload:{data,remainingWeight:-1}});
  assert.equal(invalid.statusCode,400);
  const forbidden=await app.inject({method:'POST',url:'/api/import/preview',headers:{origin:'https://untrusted.example'},payload:{input:'demo'}});
  assert.equal(forbidden.statusCode,403);
 } finally {await app.close();if(before===undefined)delete process.env.DEMO_MODE;else process.env.DEMO_MODE=before;}
});

test('unconfigured production instance reports not ready',async()=>{
 const beforeDemo=process.env.DEMO_MODE,beforeUrl=process.env.SPOOLMAN_URL;
 delete process.env.DEMO_MODE;delete process.env.SPOOLMAN_URL;
 const app=await createApp();
 try {assert.equal((await app.inject('/api/health/ready')).statusCode,503);assert.equal((await app.inject('/api/status')).json().connected,false);}
 finally {await app.close();if(beforeDemo!==undefined)process.env.DEMO_MODE=beforeDemo;if(beforeUrl!==undefined)process.env.SPOOLMAN_URL=beforeUrl;}
});
