import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignLabel, campaignOptions, campaignStart, sortCampaigns } from '../src/utils/campaigns.mjs';
test('nombre real prevalece; solo el nombre ausente usa fechas',()=>{
 const dates={start_date:'2026-07-01',end_date:'2027-06-30'};
 for(const name of ['Gruesa','Campaña 2026/27','  Especial  ']) assert.equal(campaignLabel({...dates,name}),name);
 assert.equal(campaignLabel({...dates,name:'  '}),'2026/27');
 assert.equal(campaignLabel({campaign_name:'Gruesa',campaign:'2026-2027',...dates}),'Gruesa');
 assert.equal(campaignStart({name:'2026/27'}),null);
 assert.equal(campaignStart({start_date:'2026-02-30'}),null);
 assert.equal(campaignStart({campaign_id:'a',campaign_start_date:null,start_date:'2026-10-01'}),null,'la fecha del cultivo no sustituye la fecha de campaña');
});
test('selects conservan ID; empates estables y fechas ausentes al final sin ordenar nombres',()=>{
 const rows=[{id:'a',name:'Z',start_date:'2025-10-01'},{id:'b',name:'A',start_date:'2026-10-01'},{id:'c',name:'Z',start_date:'2026-10-01'},{id:'d',name:'2029/30'}];
 assert.deepEqual(campaignOptions(rows),[{value:'b',label:'A'},{value:'c',label:'Z'},{value:'a',label:'Z'},{value:'d',label:'2029/30'}]);
 assert.deepEqual(sortCampaigns(rows).map(row=>row.id),['a','b','c','d']);
 assert.equal(rows[0].id,'a');
});
