import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {z} from 'zod';
import {Spoolman} from './spoolman.js';
import {previewInput} from './importers.js';
import {resolveLocale,translateMessage} from '../shared/messages.js';
import type {ImportData,CommitInput} from '../shared/types.js';

export async function createApp() {
  const app=Fastify({logger:true,bodyLimit:65536});
  const spoolman=new Spoolman();const demo=process.env.DEMO_MODE==='true';
  const demoData:ImportData={source:'qr',prusamentId:'demo-001',brand:'Prusament',name:'PLA Galaxy Black',material:'PLA',colorHex:'343438',diameter:1.75,density:1.24,nominalWeight:1000,initialWeight:1024,spoolWeight:201,nozzleTemp:215,bedTemp:60,warnings:['Ukázková data. V demo režimu se do Spoolmanu nezapisuje.']};
  const dataSchema=z.object({source:z.enum(['qr','nfc']),sourceUrl:z.string().url().optional(),prusamentId:z.string().max(256).optional(),instanceUuid:z.string().max(256).optional(),nfcUid:z.string().max(256).optional(),productId:z.string().max(64).optional(),brand:z.string().trim().min(1).max(64),name:z.string().trim().min(1).max(64),material:z.string().trim().min(1).max(64),colorHex:z.string().regex(/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/).optional(),diameter:z.number().positive().max(10),density:z.number().positive().max(30).optional(),nominalWeight:z.number().positive().max(100000).optional(),initialWeight:z.number().positive().max(100000).optional(),spoolWeight:z.number().nonnegative().max(10000).optional(),remainingWeight:z.number().nonnegative().optional(),nozzleTemp:z.number().int().nonnegative().max(500).optional(),bedTemp:z.number().int().nonnegative().max(250).optional(),warnings:z.array(z.string()).default([])});
  app.addHook('onRequest',async(req,reply)=>{
    if(!req.url.startsWith('/api/'))return;
    reply.header('Content-Language',resolveLocale(req.headers['accept-language']));
    reply.header('Vary','Accept-Language');
  });
  app.addHook('preSerialization',async(req,_reply,payload)=>{
    if(!req.url.startsWith('/api/')||!payload||typeof payload!=='object'||Array.isArray(payload))return payload;
    const locale=resolveLocale(req.headers['accept-language']);
    const result={...payload} as Record<string,unknown>;
    for(const key of ['message','error'])if(typeof result[key]==='string')result[key]=translateMessage(result[key],locale);
    if(result.data&&typeof result.data==='object'&&!Array.isArray(result.data)){
      const data=result.data as Record<string,unknown>;
      if(Array.isArray(data.warnings))result.data={...data,warnings:data.warnings.map(warning=>typeof warning==='string'?translateMessage(warning,locale):warning)};
    }
    return result;
  });
  app.setErrorHandler((e,_req,reply)=>{app.log.error(e);reply.code(e instanceof z.ZodError?400:502).send({message:e instanceof z.ZodError?'Zkontrolujte vyplněné údaje.':e instanceof Error?e.message:'Neočekávaná chyba serveru.'});});
  app.addHook('onRequest',async(req,reply)=>{if(req.method==='POST'&&req.headers.origin){const origin=new URL(req.headers.origin);if(origin.host!==req.headers.host&&!(process.env.NODE_ENV!=='production'&&['localhost:5173','127.0.0.1:5173'].includes(origin.host)))return reply.code(403).send({message:'Nepovolený původ požadavku.'});}});
  app.get('/api/health/live',async()=>({ok:true}));
  app.get('/api/health/ready',async(_req,reply)=>{if(!demo&&!process.env.SPOOLMAN_URL)return reply.code(503).send({ok:false});return {ok:true};});
  app.get('/api/status',async()=>{if(demo)return {connected:true,demo:true};try{await Promise.all([spoolman.request('/info'),spoolman.request('/field/spool')]);return {connected:true,demo:false};}catch(e){return {connected:false,demo:false,message:(e as Error).message};}});
  app.get('/api/filaments',async(req)=>{if(demo)return [];const q=String((req.query as any).q??'').toLowerCase();return (await spoolman.filaments()).filter(f=>`${f.vendor?.name} ${f.name} ${f.material}`.toLowerCase().includes(q));});
  app.get('/api/spools',async(req)=>{if(demo)return [];const q=String((req.query as any).q??'').toLowerCase();return (await spoolman.spools()).filter(s=>`${s.id} ${s.filament.name}`.toLowerCase().includes(q));});
  app.post('/api/import/link',async(req)=>{const body=z.object({data:dataSchema,spoolId:z.number().int().positive()}).parse(req.body);if(demo)return {spool:{id:body.spoolId,filament:{id:1,name:body.data.name}},existing:true};return spoolman.link(body.data,body.spoolId);});
  app.post('/api/import/preview',async(req)=>{const body=z.object({input:z.string().max(2048).optional(),records:z.array(z.object({mediaType:z.string().max(200),data:z.string().max(12000)})).max(16).optional(),uid:z.string().max(256).optional()}).parse(req.body);if(demo&&body.input==='demo')return {data:demoData,filaments:[],existing:[]};const data=await previewInput(body);if(demo)return {data,filaments:[],existing:[]};return {data,...await spoolman.matches(data)};});
  app.post('/api/import/commit',async(req)=>{const input=z.object({data:dataSchema,filamentId:z.number().int().positive().optional(),remainingWeight:z.number().nonnegative(),location:z.string().max(64).optional(),comment:z.string().max(700).optional()}).parse(req.body);if(demo)return {spool:{id:123,filament:{id:1,name:input.data.name},archived:false},existing:false};return spoolman.commit(input as CommitInput);});
  const client=resolve('dist/client');if(existsSync(client))await app.register(staticPlugin,{root:client});
  app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({message:'Endpoint neexistuje.'}):existsSync(client)?reply.sendFile('index.html'):reply.code(404).send({message:'Endpoint neexistuje.'}));
  return app;
}
