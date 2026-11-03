export interface ImportData {
 source: 'qr'|'nfc'; sourceUrl?: string; prusamentId?: string; instanceUuid?: string; nfcUid?: string;
 productId?: string; brand: string; name: string; material: string; colorHex?: string;
 diameter: number; density?: number; nominalWeight?: number; initialWeight?: number; spoolWeight?: number;
 remainingWeight?: number; nozzleTemp?: number; bedTemp?: number; warnings: string[];
}
export interface Filament { id:number; name?:string; material?:string; color_hex?:string; diameter?:number; density?:number; weight?:number; article_number?:string; external_id?:string; vendor?:{id:number;name:string}; }
export interface Spool { id:number; filament:Filament; comment?:string; extra?:Record<string,string>; archived?:boolean; }
export interface Preview { data:ImportData; filaments:Filament[]; existing:Spool[]; }
export interface CommitInput { data:ImportData; filamentId?:number; location?:string; comment?:string; remainingWeight:number; }
