// This function is embedded in the exported HTML and must be self-contained.
export function installPreview(target) {
  target.__PRUSAMENT_STATIC_DEMO__ = true;
  const data = {source:'qr',prusamentId:'demo-001',brand:'Prusament',name:'PLA Galaxy Black',material:'PLA',colorHex:'343438',diameter:1.75,density:1.24,nominalWeight:1000,initialWeight:1024,spoolWeight:201,nozzleTemp:215,bedTemp:60,warnings:['Veřejná ukázka: smyšlená data, žádné spojení se Spoolmanem.']};
  const filament = {id:1,name:data.name,material:data.material,color_hex:data.colorHex,diameter:1.75,vendor:{id:1,name:'Prusament'}};
  const spool = {id:42,filament,comment:'Ukázková cívka'};
  const response = (body, status = 200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
  target.fetch = async (input, options) => {
    const url = new URL(String(input), target.location.href);
    if (url.origin !== new URL(target.location.href).origin) throw new Error('Ukázka nepovoluje externí požadavky.');
    const body = options?.body ? JSON.parse(options.body) : {};
    const query = url.searchParams.get('q')?.toLowerCase() ?? '';
    switch (url.pathname) {
      case '/api/status': return response({connected:true,demo:true});
      case '/api/filaments': return response(`${filament.name} Prusament PLA`.toLowerCase().includes(query) ? [filament] : []);
      case '/api/spools': return response(`42 ${filament.name}`.toLowerCase().includes(query) ? [spool] : []);
      case '/api/import/preview':
        if (body.input !== 'demo') return response({message:'Tato ukázka používá pouze vzorová data. Zvolte „Vyzkoušet demo“.'},400);
        return response({data,filaments:[filament],existing:[]});
      case '/api/import/commit': {
        const weight = body.remainingWeight, full = body.data?.initialWeight ?? body.data?.nominalWeight;
        if (!Number.isFinite(weight) || !Number.isFinite(full) || weight < 0 || weight > full) return response({message:'Zkontrolujte počáteční a zbývající hmotnost.'},400);
        return response({spool:{id:123,filament},existing:false});
      }
      case '/api/import/link':
        return body.spoolId === 42 ? response({spool,existing:true}) : response({message:'Ukázková cívka neexistuje.'},404);
      default: return response({message:'Tato ukázka nekomunikuje se serverem.'},404);
    }
  };
}
