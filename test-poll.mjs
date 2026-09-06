import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./worker.js',import.meta.url),'utf8');
async function fixture(){
  const worker=(await import('data:text/javascript;base64,'+Buffer.from(source+'\n// '+crypto.randomUUID()).toString('base64'))).default;
  const records=new Map([['options',JSON.stringify([{name:'Existing title',poster:null}])],['counts','{"Existing title":3}'],['version','8']]);
  const env={ADMIN_POLL_TOKEN:'test-only',POLL_DATA:{get:async key=>records.get(key)??null,put:async(key,value)=>records.set(key,value)}};
  const call=(path,method='GET',body,auth=true)=>worker.fetch(new Request('https://welldonestreams.com/api'+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer test-only'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{});
  return {records,call};
}
test('empty options persist, reset counts and advance version; restoring works',async()=>{
  const {call,records}=await fixture();
  assert.equal((await call('/poll/admin','PUT',{options:[]})).status,200);
  assert.deepEqual(await (await call('/poll')).json(),{options:[],counts:{},version:'9'});
  assert.equal(records.get('options'),'[]');
  assert.equal((await call('/vote','POST',{option:'Existing title'},false)).status,400);
  assert.equal((await call('/poll/admin','PUT',{options:[{name:'New title',poster:null}]})).status,200);
  assert.deepEqual(await (await call('/poll')).json(),{options:[{name:'New title',poster:null}],counts:{'New title':0},version:'10'});
});
test('unauthorized clearing rejected without writes',async()=>{
  const {call,records}=await fixture();const before=[...records];
  assert.equal((await call('/poll/admin','PUT',{options:[]},false)).status,403);
  assert.deepEqual([...records],before);
});
test('malformed options rejected before writes',async()=>{
  for(const options of [null,{},'', [null],[' '],[{}]]){
    const {call,records}=await fixture();const before=[...records];
    assert.equal((await call('/poll/admin','PUT',{options})).status,400);
    assert.deepEqual([...records],before);
  }
});
test('legacy string options still supported',async()=>{
  const {call}=await fixture();assert.equal((await call('/poll/admin','PUT',{options:['Title']})).status,200);
  assert.deepEqual((await (await call('/poll')).json()).options,[{name:'Title',poster:null}]);
});
