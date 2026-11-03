import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { campaignContainsWorkRange, campaignContainsWorkDate, orderCampaignsForRange, campaignWindowWarning, planningCampaignDatesChanged, campaignWorkEnd } from '../src/utils/campaigns.mjs';
const campaign={id:'gruesa',name:'Gruesa 2026-2027',work_start_date:'2026-07-30',start_date:'2026-11-01',end_date:'2027-06-30',work_end_date:'2027-07-31'};
test('inclusive operational membership is independent of official boundaries and status',()=>{
 for(const date of ['2026-07-30','2026-10-20','2026-11-01','2027-06-30','2027-07-31']) {
  assert.equal(campaignContainsWorkDate(campaign,dayjs(date)),true);
  assert.equal(campaignContainsWorkDate({...campaign,status:'closed'},date),true);
 }
 for(const date of ['2026-07-29','2027-08-01'])assert.equal(campaignContainsWorkDate(campaign,date),false);
 assert.equal(campaignContainsWorkRange(campaign,['2026-10-20','2027-08-01']),false);
});
test('compatible campaigns first, all incompatible remain and inputs are immutable',()=>{
 const outside={...campaign,id:'other',work_start_date:'2027-01-01',start_date:'2027-01-01'};
 const original=[outside,campaign,{...campaign,id:'overlap'}], range=['2026-10-20','2026-10-20'];
 assert.deepEqual(orderCampaignsForRange(original,range).map(c=>c.id),['gruesa','overlap','other']);
 assert.equal(original[0],outside);
});
test('open ends and operational fallbacks preserve compatibility',()=>{
 assert.equal(campaignWorkEnd({...campaign,work_end_date:null}),'2027-06-30');
 assert.equal(campaignContainsWorkDate({...campaign,end_date:null,work_end_date:null},'2040-01-01'),true);
});
test('historical mismatch warns but unchanged calendar dates and campaign allow unrelated edits',()=>{
 const row={campaign_id:'gruesa',start_at:'2025-10-20T12:00:00Z',end_at:'2025-10-20T13:00:00Z'},range=[dayjs('2025-10-20'),dayjs('2025-10-20')];
 assert.equal(campaignContainsWorkRange(campaign,range),false);
 assert.equal(planningCampaignDatesChanged(row,'gruesa',range),false);
 assert.equal(planningCampaignDatesChanged(row,'other',range),true);
 assert.equal(planningCampaignDatesChanged(row,'gruesa',[dayjs('2025-10-21'),dayjs('2025-10-21')]),true);
 assert.equal(planningCampaignDatesChanged(null,'gruesa',range),true);
 assert.equal(campaignWindowWarning(campaign),'La fecha seleccionada está fuera de la ventana operativa de Gruesa 2026-2027.');
});
