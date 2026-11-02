const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, projectPath, OWNER_KEY, ENDPOINT } = require('../apps/keraba/cloud-store.js');
const location = { href:'https://example.test/tools/apps/keraba/', hash:'' };
function storage() {
  const map = new Map();
  return { getItem:key=>map.get(key)||null, setItem:(key,value)=>map.set(key,value) };
}

test('自分の保存先を自動で作り、再起動後も同じ保存先へ接続し、認証操作を要求しない', async () => {
  const saved = storage(), owners = [];
  const fetcher = async (url, options) => {
    assert.equal(url,ENDPOINT); assert.equal(options.headers.Authorization,undefined);
    assert.equal(options.credentials,'omit'); assert.equal(options.cache,'no-store'); assert.equal(options.redirect,'error');
    owners.push(options.headers['X-Keraba-Owner']);
    assert.ok(!options.body.includes(owners.at(-1)));
    return Response.json({items:[]});
  };
  const first = createStore({storage:saved,location,fetcher,random:bytes=>bytes.fill(1)});
  assert.equal(saved.getItem(OWNER_KEY),null);
  await first.list();
  const second=createStore({storage:saved,location,fetcher}); await second.list();
  assert.match(owners[0],/^[a-f0-9]{64}$/); assert.equal(owners[0],owners[1]);
  assert.equal(typeof first.connect,'undefined'); assert.equal(typeof first.setToken,'undefined');
});

test('別ブラウザは別の一覧になり、外部リンクから保存先を切り替えない', async () => {
  const owners=[];
  const fetcher=async (url,options)=>{owners.push(options.headers['X-Keraba-Owner']);return Response.json({items:[]});};
  const a=createStore({storage:storage(),fetcher,random:bytes=>bytes.fill(1)});
  const b=createStore({storage:storage(),fetcher,random:bytes=>bytes.fill(2)});
  await a.list(); await b.list(); assert.notEqual(owners[0],owners[1]);
  assert.equal(typeof a.personalLink,'undefined');
});

test('識別番号を記憶できない場合は保存先を使い捨てにせず、送信を止める', async () => {
  let calls=0;
  const blocked={getItem(){throw new Error();},setItem(){throw new Error();}};
  const fetcher=async()=>{calls++;return Response.json({items:[]});};
  const a=createStore({storage:blocked,location,fetcher});
  await assert.rejects(a.list(),/保存先を記憶できません/); assert.equal(calls,0);
});

test('JSONと小数・空欄をクラウドへ送り、開いた版番号を添えて更新する', async () => {
  const requests=[];
  const doc={format:'keraba-project',version:1,roofMode:'normal',inputs:{name:'保存検証',pitch:4.25,blank:null}};
  const store=createStore({storage:storage(),location,fetcher:async (url,options)=>{
    const body=JSON.parse(options.body);requests.push(body);
    return Response.json(body.action==='save'?{path:body.name,sha:'3'}:{path:body.name,sha:'2',text:JSON.stringify(doc)});
  }});
  const read=await store.read('保存検証');
  assert.equal(read.sha,'2'); assert.deepEqual(JSON.parse(read.text),doc);
  await store.save('保存検証',JSON.stringify(doc),read.sha);
  assert.deepEqual(requests[1],{action:'save',name:'保存検証',document:doc,revision:2});
});

test('重複・更新競合・大きすぎる保存を区別し、勝手に再試行しない', async () => {
  for(const [status,message] of [[409,/別の画面/],[413,/1 MB/],[500,/通信に失敗/]]) {
    let calls=0;
    const store=createStore({storage:storage(),location,fetcher:async()=>{calls++;return new Response('',{status});}});
    await assert.rejects(store.save('検証','{}'),message); assert.equal(calls,1);
  }
  const missing=createStore({storage:storage(),location,fetcher:async()=>new Response('',{status:404})});
  assert.equal(await missing.read('検証',true),null);
  await assert.rejects(missing.read('検証'),/通信に失敗/);
});

test('タイムアウトとネットワーク切断では保存完了を未確認として扱う', async () => {
  const timeout=createStore({storage:storage(),location,timeout:1,fetcher:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('','AbortError'))))});
  await assert.rejects(timeout.save('検証','{}'),/保存完了を確認できません/);
  const offline=createStore({storage:storage(),location,fetcher:async()=>{throw new TypeError('network');}});
  await assert.rejects(offline.list(),/ネットワーク/);
});

test('保存名とUTF-8の1 MB境界を検証し、不正入力では送信しない', async () => {
  for(const name of ['', 'a/b', 'CON', 'name.', 'a'.repeat(121)]) assert.throws(()=>projectPath(name));
  let calls=0;
  const store=createStore({storage:storage(),location,fetcher:async(url,options)=>{calls++;return Response.json({path:JSON.parse(options.body).name,sha:'1'});}});
  const base=Buffer.byteLength(JSON.stringify({pad:''})), remaining=1024*1024-base;
  const exact=JSON.stringify({pad:'あ'.repeat(Math.floor(remaining/3))+'a'.repeat(remaining%3)});
  assert.equal(Buffer.byteLength(exact),1024*1024); await store.save('検証',exact);
  await assert.rejects(store.save('検証',exact+' '),/1 MB/); assert.equal(calls,1);
});

test('重複新規保存の応答だけから上書き確認用の版を取得し、未知の応答は信用しない',async()=>{
  for(const revision of ['7','invalid','0','9007199254740992']){
    const store=createStore({storage:storage(),fetcher:async()=>Response.json({existingRevision:revision},{status:409})});
    await assert.rejects(store.save('検証','{}'),error=>{
      assert.equal(error.status,409);assert.equal(error.existingSha,revision==='7'?'7':undefined);return true;
    });
  }
});
