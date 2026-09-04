const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const file = path.join(__dirname, '../workflows/discord-notify.yml');
async function run(event, payload = {}, options = {}) {
  assert.ok(fs.existsSync(file), 'reusable notification workflow is missing');
  const yaml = fs.readFileSync(file, 'utf8');
  const script = yaml.split('          script: |\n')[1].split('\n').map(l => l.replace(/^            /, '')).join('\n');
  const context = {eventName:event, payload:{sender:{login:'tester'}, ...payload}, repo:{owner:'ai-project-team3',repo:'example'}, runId:123};
  const calls = [], failures = [], logs = [];
  const fakeUrl = 'https://discord.com/api/webhooks/123/not-a-real-credential';
  const fetch = async (url, init) => {
    calls.push({url:String(url),init});
    if(options.networkError) throw new Error(fakeUrl);
    return {ok: !options.status, status: options.status || 200, json:async()=>({id:'456',channel_id:'789'})};
  };
  await new AsyncFunction('context','core','fetch','process',script)(context,{setFailed:m=>failures.push(m),info:m=>logs.push(m)},fetch,{env:{DISCORD_WEBHOOK_URL:options.missing?'':fakeUrl}});
  return {calls,failures,logs,content:calls[0] && JSON.parse(calls[0].init.body).content};
}
for (const [event,payload,expected] of [
  ['push',{ref:'refs/heads/main',commits:[{id:'abcdef123',message:'New feature\nMore',author:{name:'Dev'},url:'https://github.com/commit/abcdef123'}]},'main에 push'],
  ['pull_request',{action:'opened',pull_request:{number:3,title:'Feature',html_url:'https://github.com/pr/3'}},'PR #3'],
  ['pull_request_review',{action:'submitted',pull_request:{number:3,title:'Feature'}},'PR #3'],
  ['pull_request_review_comment',{action:'created',pull_request:{number:3,title:'Feature'}},'PR #3'],
  ['issues',{action:'opened',issue:{number:4,title:'Bug'}},'Issue #4'],
  ['issue_comment',{action:'created',issue:{number:4,title:'Bug'}},'Issue #4'],
  ['discussion',{action:'created',discussion:{number:5,title:'Idea'}},'Discussion #5'],
  ['discussion_comment',{action:'created',discussion:{number:5,title:'Idea'}},'Discussion #5'],
  ['create',{ref_type:'branch',ref:'feature'},'create: branch feature'],
  ['delete',{ref_type:'branch',ref:'feature'},'delete: branch feature'],
  ['release',{action:'published',release:{tag_name:'v1',name:'Release'}},'Release published: v1'],
  ['workflow_dispatch',{},'알림 연결 테스트'],
]) test(`sends ${event} metadata with actor and disabled mentions`,async()=>{
  const r=await run(event,payload);
  assert.equal(r.calls.length,1);
  assert.ok(r.content.includes(expected));
  assert.ok(r.content.includes('작업자: tester'));
  assert.deepEqual(JSON.parse(r.calls[0].init.body).allowed_mentions,{parse:[]});
  assert.equal(new URL(r.calls[0].url).searchParams.get('wait'),'true');
  assert.equal(r.calls[0].init.redirect,'error');
  assert.deepEqual(r.failures,[]);
});
test('limits large messages to Discord size',async()=>{
  const r=await run('issues',{issue:{number:1,title:'x'.repeat(5000)}});
  assert.ok(r.content.length<=1900);
});
test('missing secret fails without issuing a request',async()=>{
  const r=await run('push',{}, {missing:true});
  assert.equal(r.calls.length,0); assert.equal(r.failures.length,1);
});
test('HTTP errors report only status',async()=>{
  const r=await run('push',{}, {status:429});
  assert.deepEqual(r.failures,['Discord webhook failed: HTTP 429']);
});
test('network error never logs credential-bearing exception',async()=>{
  const r=await run('push',{}, {networkError:true});
  assert.equal(r.failures.length,1);
  assert.ok(!JSON.stringify([r.failures,r.logs]).includes('not-a-real-credential'));
});
