const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM, VirtualConsole } = require("jsdom");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function suite(t, { hash = "", stored = null, blocked = false } = {}) {
  const dom = new JSDOM(read("index.html"), {
    url: "https://example.test/tools/" + hash,
    runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  if (stored) dom.window.localStorage.setItem("wood-calculators.active.v1", stored);
  if (blocked) Object.defineProperty(dom.window, "localStorage", { get() { throw new Error("保存不可"); } });
  dom.window.eval(read("js/suite.js"));
  const tab = (id) => dom.window.document.getElementById("tab-" + id);
  const panel = (id) => dom.window.document.getElementById("panel-" + id);
  return { w: dom.window, tab, panel, frame: (id) => panel(id).querySelector("iframe") };
}

test("起動時は本文の解析前から隠し、保存したタブを復元してから表示する", (t) => {
  const dom = new JSDOM(read("index.html"), { url: "https://example.test/tools/", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const script = document.querySelector('script[src^="js/suite.js"]');
  assert.equal(script.defer, false);
  assert.equal(script.parentElement, document.head);
  const body = document.body;
  body.remove();
  dom.window.localStorage.setItem("wood-calculators.active.v1", "bolt");
  dom.window.eval(read("js/suite.js"));
  assert.equal(document.documentElement.classList.contains("suite-starting"), true);
  document.documentElement.append(body);
  document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  assert.equal(document.documentElement.classList.contains("suite-starting"), false);
  assert.equal(document.querySelector('[aria-selected="true"]').dataset.app, "bolt");
  assert.equal(document.querySelector("#panel-keraba iframe").hasAttribute("src"), false);
});

test("初回の画面は復元完了まで読み込み表示とし、切替後も完了済み画面を読み直さない", (t) => {
  const a = suite(t, { stored: "bolt" });
  assert.equal(a.panel("bolt").hasAttribute("data-loading"), true);
  assert.equal(a.panel("bolt").getAttribute("aria-busy"), "true");
  assert.equal(a.panel("bolt").querySelector('[role="status"]').textContent, "読み込み中…");
  a.tab("keraba").click();
  a.frame("bolt").dispatchEvent(new a.w.Event("load"));
  assert.equal(a.panel("bolt").hasAttribute("data-loading"), false);
  assert.equal(a.panel("bolt").getAttribute("aria-busy"), "false");
  assert.equal(a.panel("bolt").getAttribute("aria-hidden"), "true");
  a.tab("bolt").click();
  assert.equal(a.panel("bolt").hasAttribute("data-loading"), false);
  assert.equal(a.panel("keraba").hasAttribute("data-loading"), true);
  a.frame("keraba").dispatchEvent(new a.w.Event("load"));
  a.tab("keraba").click();
  assert.equal(a.panel("keraba").hasAttribute("data-loading"), false);
});

test("統合画面は選択した計算だけを開き、切替では画面や入力を読み直さない", (t) => {
  const a = suite(t);
  const keraba = a.frame("keraba");
  const src = keraba.src;
  assert.ok(src.includes("apps/keraba/index.html"));
  assert.equal(a.frame("bolt").hasAttribute("src"), false);
  a.tab("bolt").click();
  assert.equal(a.panel("keraba").hasAttribute("inert"), true);
  assert.equal(a.tab("bolt").getAttribute("aria-selected"), "true");
  assert.equal(a.panel("bolt").getAttribute("aria-hidden"), "false");
  const bolt = a.frame("bolt");
  a.tab("kebiki").click();
  assert.ok(a.frame("kebiki").src.includes("apps/kebiki/index.html"));
  a.tab("bolt").click();
  a.tab("keraba").click();
  assert.equal(a.frame("bolt"), bolt);
  assert.equal(a.frame("keraba"), keraba);
  assert.equal(keraba.src, src);
  assert.equal(a.w.location.hash, "#keraba");
  assert.equal(a.w.localStorage.getItem("wood-calculators.active.v1"), "keraba");
});

test("画面指定・前回の画面・キーボード・戻る操作が同じ選択を示す", (t) => {
  const a = suite(t, { hash: "#kebiki", stored: "keraba" });
  assert.equal(a.tab("kebiki").getAttribute("aria-selected"), "true");
  a.tab("kebiki").dispatchEvent(new a.w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(a.w.document.activeElement, a.tab("keraba"));
  assert.equal(a.tab("keraba").tabIndex, 0);
  assert.equal(a.tab("kebiki").tabIndex, -1);
  a.w.location.hash = "bolt";
  a.w.dispatchEvent(new a.w.HashChangeEvent("hashchange"));
  assert.equal(a.tab("bolt").getAttribute("aria-selected"), "true");
  const b = suite(t, { stored: "kebiki" });
  assert.equal(b.tab("kebiki").getAttribute("aria-selected"), "true");
});

test("不正な画面指定・保存不能でも外部URLを開かず、旧寸法リンクも使える", (t) => {
  const a = suite(t, { hash: "#https://unknown.test/", stored: "bad", blocked: true });
  assert.equal(a.tab("keraba").getAttribute("aria-selected"), "true");
  a.tab("kebiki").click();
  assert.equal(a.tab("kebiki").getAttribute("aria-selected"), "true");
  const b = suite(t, { hash: "#dimension-details", stored: "keraba" });
  assert.equal(b.tab("bolt").getAttribute("aria-selected"), "true");
  assert.ok(b.frame("bolt").src.endsWith("#drawing"));
  assert.equal(b.frame("keraba").hasAttribute("src"), false);
  assert.equal(b.frame("bolt").getAttribute("src"), b.frame("bolt").dataset.src);
  assert.equal(b.w.location.pathname, "/tools/");
  assert.equal(b.w.location.hash, "#dimension-details");
  const c = suite(t, { hash: "#result-section" });
  assert.ok(c.frame("bolt").src.endsWith("#result-section"));
  assert.equal(c.frame("keraba").hasAttribute("src"), false);
});

function kebiki(t, saved = null, blocked = false) {
  const errors=[];
  const console=new VirtualConsole();
  console.on('jsdomError',error=>errors.push(error.message));
  const dom = new JSDOM(read("apps/kebiki/index.html"), {
    url: "https://example.test/tools/apps/kebiki/", runScripts: "dangerously", virtualConsole:console,
    beforeParse(w) {
      w.localStorage.setItem("bolt-proof", "keep");
      w.localStorage.setItem("keraba-proof", "keep");
      if (saved != null) w.localStorage.setItem("kebiki-line.input.v1", saved);
      w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
      w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
      if(blocked)Object.defineProperty(w,'localStorage',{get(){throw new Error('保存不可');}});
    },
  });
  t.after(() => {assert.deepEqual(errors,[]);dom.window.close();});
  const get = (id) => dom.window.document.getElementById(id);
  return { w: dom.window, get, change(id, value) { get(id).value = value; get(id).dispatchEvent(new dom.window.Event("input", { bubbles: true })); } };
}

// 補正式を写さず、2本の直線の交点を作って天端上の距離を測る。
function lineIntersection(a,b,c,d){
  const r=[b[0]-a[0],b[1]-a[1]],s=[d[0]-c[0],d[1]-c[1]];
  const cross=(u,v)=>u[0]*v[1]-u[1]*v[0];
  const t=cross([c[0]-a[0],c[1]-a[1]],s)/cross(r,s);
  return [a[0]+t*r[0],a[1]+t*r[1]];
}
function roofTopMeasurements({keta,kobai,noki,taruki,notchType}){
  const slope=kobai/10,top=x=>-x*slope,bottom=x=>top(x)+taruki*Math.hypot(1,slope);
  const corner=[-keta/2,notchType==='techno'?bottom(-keta/2)-10:bottom(notchType==='standard'?-22.5:0)];
  const roofA=[0,0],roofB=[1000,top(1000)],end=[-noki,top(-noki)];
  const vertical=lineIntersection(roofA,roofB,corner,[corner[0],corner[1]+1]);
  const normal=lineIntersection(roofA,roofB,corner,[corner[0]+slope,corner[1]+1]);
  const distance=point=>Math.hypot(point[0]-end[0],point[1]-end[1]);
  return {tatsu:distance(vertical),kane:distance(normal),normal};
}

test("標準欠きのタツ・カネを表示し、保存復元しても数値が一致する", (t) => {
  const a = kebiki(t);
  for (const [keta, kobai, noki, taruki, tatsu, kane] of [
    ["105", "1", "455", "60", "404.5", "398.8"],
    ["90", "4", "600", "90", "597.8", "565.1"],
    ["105", "9", "1000", "100", "1274.7", "1202.8"],
    ["105", "2.5", "637", "60", "602.5", "589.3"],
  ]) {
    for (const [id, value] of Object.entries({ keta, kobai, noki, taruki })) a.change(id, value);
    assert.equal(a.get("kane").parentElement.querySelector(".title").textContent, "タツ");
    assert.equal(a.get("kane").textContent, tatsu);
    assert.equal(a.get("tatsu").textContent, kane);
  }
  const b = kebiki(t, a.w.localStorage.getItem("kebiki-line.input.v1"));
  assert.equal(b.get("noki").value, "637");
  assert.equal(b.get("kane").textContent, "602.5");
  assert.equal(b.w.localStorage.getItem("bolt-proof"), "keep");
  assert.equal(b.w.localStorage.getItem("keraba-proof"), "keep");
});

test("垂木の途中入力は補完せず復元し、壊れた保存は空欄から使える", (t) => {
  const a = kebiki(t);
  a.change("taruki", "");
  assert.equal(a.get("kane").textContent, "—");
  const b = kebiki(t, a.w.localStorage.getItem("kebiki-line.input.v1"));
  assert.equal(b.get("taruki").value, "");
  assert.equal(b.get("tatsu").textContent, "—");
  const c = kebiki(t, "{broken");
  assert.equal(c.get("kane").textContent, "—");
  for(const id of ['keta','kobai','noki','taruki'])assert.equal(c.get(id).value,'');
});

test('欠きは標準を既定とし、3択の条件・保存・再読込が同じ結果になる',t=>{
  const values={keta:'90',kobai:'4',noki:'600',taruki:'90'};
  const a=kebiki(t,JSON.stringify(values));
  assert.equal(a.get('notchType').value,'standard');
  assert.deepEqual([...a.get('notchType').options].filter(option=>option.value).map(option=>option.textContent),['標準','芯欠き','テクノ']);
  for(const [notchType,label,hint,tatsu,kane]of [
    ['standard','標準',/22.5 mm/,'597.8','565.1'],
    ['centerNotch','芯欠き',/0 mm/,'597.8','568.4'],
    ['techno','テクノ',/鉛直に10 mm/,'597.8','565.5']
  ]){
    a.change('notchType',notchType);
    assert.equal(a.get('kane').textContent,tatsu);assert.equal(a.get('tatsu').textContent,kane);
    assert.equal(a.get('notch-hint').hidden,false);assert.match(a.get('notch-hint').textContent,hint);
    assert.match(a.get('notchType').getAttribute('aria-describedby'),/notch-hint/);
    assert.equal(a.get('result-condition').textContent,label+'｜垂木天端の先端から桁角の基準線まで');
    assert.match(a.get('notch-hint').textContent,/タツは鉛直線.*カネは勾配に直角.*天端/);
    for(const [id,value]of Object.entries(values))assert.equal(a.get(id).value,value);
    const saved=a.w.localStorage.getItem('kebiki-line.input.v1');assert.equal(JSON.parse(saved).notchType,notchType);
    const b=kebiki(t,saved);assert.equal(b.get('notchType').value,notchType);
    assert.equal(b.get('kane').textContent,tatsu);assert.equal(b.get('tatsu').textContent,kane);
  }
});

test('以前の通常と種類なしの保存は標準で開き、保存元や途中の空欄を変えない',t=>{
  for(const notchType of [undefined,'center']){
    const values={keta:'90',kobai:'4',noki:'600',taruki:'90'};
    if(notchType!==undefined)values.notchType=notchType;
    const original=JSON.stringify(values),a=kebiki(t,original);
    assert.equal(a.get('notchType').value,'standard');assert.equal(a.get('kane').textContent,'597.8');
    assert.equal(a.w.localStorage.getItem('kebiki-line.input.v1'),original);
    a.change('noki','');
    assert.equal(a.get('kane').textContent,'—');assert.equal(JSON.parse(a.w.localStorage.getItem('kebiki-line.input.v1')).notchType,'standard');
    const b=kebiki(t,a.w.localStorage.getItem('kebiki-line.input.v1'));
    assert.equal(b.get('noki').value,'');assert.equal(b.get('notchType').value,'standard');
  }
});

test('3種類のタツは桁角の鉛直線と垂木天端の交点から、天端の先端まで測る',t=>{
  const a=kebiki(t),keraba=new JSDOM(read('apps/keraba/index.html'),{
    url:'https://example.test/keraba/',runScripts:'dangerously',pretendToBeVisual:true,
  });t.after(()=>keraba.window.close());
  for(const notchType of ['standard','centerNotch','techno'])for(const roofMode of ['normal','tile'])for(const [keta,kobai,noki,taruki]of [
    [105,2.5,637,60],[90,4,600,90],[120,1.33,450,90],[105,4,0,60],
    [300,0.05,2000,300],[105,4,52.4999,60],[105,4,52.5,60],[105,4,52.5001,60]
  ]){
    for(const [id,value]of Object.entries({keta,kobai,noki,taruki}))a.change(id,String(value));
    a.change('notchType',notchType);
    const g=keraba.window.geometry({...keraba.window.getParams(),moyaSize:keta,pitch:kobai,hTaruki:taruki,notchType,roofMode});
    const endX=g.moya.xc-noki,startX=g.moya.xL;
    const distance=Math.hypot(startX-endX,g.lnD(startX)-g.lnD(endX));
    assert.equal(a.get('kane').textContent,distance.toFixed(1));
  }
});

test('3種類のカネは桁角からの勾配直角線と垂木天端の交点まで測る',t=>{
  const a=kebiki(t),keraba=new JSDOM(read('apps/keraba/index.html'),{
    url:'https://example.test/keraba/',runScripts:'dangerously',pretendToBeVisual:true,
  });
  t.after(()=>keraba.window.close());
  const examples=[[105,2.5,637,60],[105,4,600,60],[90,1.33,450,90],[110.5,3.75,600.5,75.5],
    [105,5,0,60],[105,9,2000,100],[300,0.5,0,300],
    [105,4,52.4999,60],[105,4,52.5,60],[105,4,52.5001,60],
    [10,0.05,0,1],[300,5,2000,300],
    // 桁角より先端が内側にある場合も、2点の距離で確認する。
    [105,4,48.3619,60],[105,4,48.3622,60],
    [105,4,45.2585,60],[105,4,45.2588,60],
    [105,4,49.0516,60],[105,4,49.0519,60]];
  for(const [notchType,label]of [['standard','標準'],['centerNotch','芯欠き'],['techno','テクノ']])
  for(const roofMode of ['normal','tile'])for(const [keta,kobai,noki,taruki]of examples){
    for(const [id,value]of Object.entries({keta,kobai,noki,taruki}))a.change(id,String(value));
    a.change('notchType',notchType);
    const g=keraba.window.geometry(Object.assign(keraba.window.eval('getParams()'),{
      moyaSize:keta,pitch:kobai,hTaruki:taruki,notchType,roofMode,
    }));
    const end=[g.moya.xc-noki,g.lnD(g.moya.xc-noki)],corner=[g.moya.xL,g.moya.yT];
    const normal=lineIntersection([0,g.lnD(0)],[1000,g.lnD(1000)],corner,[corner[0]+g.tan,corner[1]+1]);
    const distance=Math.hypot(normal[0]-end[0],normal[1]-end[1]);
    assert.ok(Math.abs(normal[1]-g.lnD(normal[0]))<1e-8);
    assert.equal(a.get('tatsu').textContent,distance.toFixed(1));
    assert.equal(a.get('result-condition').textContent,label+'｜垂木天端の先端から桁角の基準線まで');
  }
});

test('テクノも4項目がそろうまで結果を出さず、範囲外・大きすぎる値を補正しない',t=>{
  const a=kebiki(t,null,true);a.change('notchType','techno');
  for(const [id,value]of Object.entries({keta:'105',kobai:'4',noki:'600'}))a.change(id,value);
  assert.equal(a.get('kane').textContent,'—');a.change('taruki','60');
  assert.equal(a.get('kane').textContent,'589.7');assert.equal(a.get('tatsu').textContent,'569.4');
  a.change('noki','2000.1');assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('noki-error').hidden,false);
  a.change('noki','600');a.change('kobai','1e308');
  assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('tatsu').textContent,'—');
  assert.equal(a.get('kobai-error').hidden,false);assert.ok(!a.w.document.body.textContent.includes('Infinity'));
  for(const [id,value]of Object.entries({keta:'1',taruki:'1',kobai:'0',noki:'0'}))a.change(id,value);
  assert.equal(a.get('kane').textContent,'0.5');assert.equal(a.get('tatsu').textContent,'0.5');
  for(const [id,value]of Object.entries({keta:'300',taruki:'300',noki:'2000'}))a.change(id,value);
  assert.equal(a.get('kane').textContent,'1850.0');assert.equal(a.get('tatsu').textContent,'1850.0');
  a.get('btnReset').click();a.get('resetConfirm').click();
  assert.equal(a.get('notchType').value,'standard');assert.equal(a.get('noki').value,'');
});

test('不正な欠き種類を保存から読んだ場合は数値を残して種類の選択を求める',t=>{
  for(const notchType of ['unknown',null,3,{},[],'constructor','__proto__']){
    const a=kebiki(t,JSON.stringify({keta:'105',kobai:'4',noki:'600',taruki:'60',notchType}));
    assert.equal(a.get('notchType').value,'');assert.equal(a.get('notchType-error').hidden,false);
    assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('tatsu').textContent,'—');
    assert.equal(a.get('noki').value,'600');
    a.change('notchType','standard');assert.notEqual(a.get('kane').textContent,'—');
    assert.equal(a.get('notchType-error').hidden,true);
  }
});

test('芯欠き・テクノの選択をリセットすると確認後に標準と空欄へ戻し、他画面の保存を維持する',t=>{
  for(const type of ['centerNotch','techno']){
    const a=kebiki(t);a.change('notchType',type);
    a.get('btnReset').click();assert.equal(a.get('resetDialog').open,true);a.get('resetCancel').click();
    assert.equal(a.get('notchType').value,type);
    a.get('btnReset').click();a.get('resetConfirm').click();
    assert.equal(a.get('notchType').value,'standard');assert.match(a.get('notch-hint').textContent,/22.5 mm/);
    for(const id of ['keta','kobai','noki','taruki'])assert.equal(a.get(id).value,'');
    assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('tatsu').textContent,'—');
    assert.equal(a.w.localStorage.getItem('bolt-proof'),'keep');assert.equal(a.w.localStorage.getItem('keraba-proof'),'keep');
    const b=kebiki(t,a.w.localStorage.getItem('kebiki-line.input.v1'));assert.equal(b.get('notchType').value,'standard');
    a.get('btnReset').click();assert.equal(a.get('resetDialog').open,false);
  }
});

test('けびき線は屋根寸法を上に置き、初回は4項目とも空欄で計算しない',t=>{
  const a=kebiki(t);
  assert.deepEqual([...a.w.document.querySelectorAll('legend')].map(el=>el.textContent),['屋根の寸法','部材寸法']);
  assert.deepEqual([...a.w.document.querySelectorAll('input[type="number"]')].map(el=>el.id),['kobai','noki','keta','taruki']);
  for(const id of ['keta','kobai','noki','taruki'])assert.equal(a.get(id).value,'');
  assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('tatsu').textContent,'—');
});

test('桁90・105・120、垂木60・90、勾配1〜5の候補を選んでも自由入力へ続けて変更できる',t=>{
  const a=kebiki(t);
  const expected={keta:['90','105','120'],taruki:['60','90'],kobai:['1','1.5','2','2.5','3','3.5','4','4.5','5']};
  for(const [id,values]of Object.entries(expected)){
    const select=a.get(id+'-choice');
    assert.deepEqual([...select.options].filter(option=>option.value).map(option=>option.value),values);
    for(const value of values){
      select.value=value;select.dispatchEvent(new a.w.Event('change',{bubbles:true}));
      assert.equal(a.get(id).value,value);assert.equal(select.value,'');assert.equal(a.w.document.activeElement,a.get(id));
    }
  }
  for(const [id,value]of Object.entries({keta:'110.5',taruki:'75.5',kobai:'3.75',noki:'600.5'}))a.change(id,value);
  assert.notEqual(a.get('kane').textContent,'—');assert.equal(a.get('kobai').value,'3.75');
  a.get('kobai-choice').value='4';a.get('kobai-choice').dispatchEvent(new a.w.Event('change'));
  assert.equal(a.get('kobai').value,'4');
});

test('桁・垂木1〜300、軒0〜2000の境界を検証し、範囲外は補正せず計算結果を消す',t=>{
  const a=kebiki(t);
  const valid={keta:'105',taruki:'60',kobai:'3.5',noki:'455'};
  for(const [id,value]of Object.entries(valid))a.change(id,value);
  for(const [id,values]of Object.entries({keta:['1','300'],taruki:['1','300'],noki:['0','2000'],kobai:['0','0.5','9']})){
    for(const value of values){a.change(id,value);assert.notEqual(a.get('kane').textContent,'—');assert.equal(a.get(id).getAttribute('aria-invalid'),'false');}
    a.change(id,valid[id]);
  }
  for(const [id,values]of Object.entries({keta:['0','0.9','300.1'],taruki:['0','0.9','300.1'],noki:['-0.1','2000.1'],kobai:['-0.1']})){
    for(const value of values){
      a.change(id,value);assert.equal(a.get(id).value,value);assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('tatsu').textContent,'—');
      assert.equal(a.get(id).getAttribute('aria-invalid'),'true');assert.equal(a.get(id+'-error').hidden,false);
    }
    a.change(id,valid[id]);assert.notEqual(a.get('kane').textContent,'—');
  }
  a.change('kobai','1e308');assert.equal(a.get('kane').textContent,'—');assert.ok(!a.w.document.body.textContent.includes('Infinity'));
});

test('リセットをキャンセルすれば入力を維持し、確定後は再読込しても空欄になる',t=>{
  const a=kebiki(t);for(const [id,value]of Object.entries({keta:'120',taruki:'90',kobai:'4.5',noki:'650'}))a.change(id,value);
  const before=a.w.localStorage.getItem('kebiki-line.input.v1'),result=a.get('kane').textContent;
  a.get('btnReset').click();assert.equal(a.get('resetDialog').open,true);a.get('resetCancel').click();
  assert.equal(a.w.localStorage.getItem('kebiki-line.input.v1'),before);assert.equal(a.get('kane').textContent,result);
  a.get('btnReset').click();a.get('resetConfirm').click();
  for(const id of ['keta','kobai','noki','taruki'])assert.equal(a.get(id).value,'');
  assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('tatsu').textContent,'—');
  const b=kebiki(t,a.w.localStorage.getItem('kebiki-line.input.v1'));for(const id of ['keta','kobai','noki','taruki'])assert.equal(b.get(id).value,'');
  assert.equal(a.w.localStorage.getItem('bolt-proof'),'keep');assert.equal(a.w.localStorage.getItem('keraba-proof'),'keep');
  a.get('btnReset').click();assert.equal(a.get('resetDialog').open,false);
});

test('全項目がそろうまで結果を表示せず、保存領域が使えなくても計算とリセットは動く',t=>{
  const a=kebiki(t,null,true);
  for(const [id,value]of Object.entries({keta:'105',taruki:'60',kobai:'1'}))a.change(id,value);
  assert.equal(a.get('kane').textContent,'—');a.change('noki','455');assert.equal(a.get('kane').textContent,'404.5');
  a.get('btnReset').click();a.get('resetConfirm').click();assert.equal(a.get('keta').value,'');assert.equal(a.get('kane').textContent,'—');
});

test('水平・小さい桁・基準線が先端の外側にある場合も、天端上の2点間の距離になる',t=>{
  const a=kebiki(t);
  for(const notchType of ['standard','centerNotch','techno']){
    const examples=[[1,5,0,300],[300,0,2000,300],[105,0,0,60],[1,0.001,0,1],[105,2.5,637,60]];
    const root=roofTopMeasurements({keta:105,kobai:4,noki:600,taruki:60,notchType});
    for(const delta of [-.1,0,.1])examples.push([105,4,-root.normal[0]+delta,60]);
    for(const [keta,kobai,noki,taruki]of examples){
      for(const [id,value]of Object.entries({keta,kobai,noki,taruki}))a.change(id,String(value));
      a.change('notchType',notchType);
      const expected=roofTopMeasurements({keta,kobai,noki,taruki,notchType});
      assert.equal(a.get('kane').textContent,expected.tatsu.toFixed(1));
      assert.equal(a.get('tatsu').textContent,expected.kane.toFixed(1));
      assert.ok(Number(a.get('kane').textContent)>=0);assert.ok(Number(a.get('tatsu').textContent)>=0);
    }
  }
});

test("ケラバの通常・瓦の図と保存を引き継ぎ、子画面は更新処理を重複させない", (t) => {
  let requests = 0;
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (error) => errors.push(error.message));
  const dom = new JSDOM(read("apps/keraba/index.html"), {
    url: "https://example.test/tools/apps/keraba/", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: console,
    beforeParse(w) {
      w.fetch = () => { requests++; return Promise.reject(new Error("外部要求")); };
      Object.defineProperty(w.navigator, "serviceWorker", { value: { register() { requests++; }, addEventListener() {} } });
    },
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  assert.equal(w.document.querySelectorAll("svg").length, 2);
  assert.ok(!w.document.querySelector("svg").outerHTML.includes("NaN"));
  w.document.getElementById("tabTile").click();
  assert.equal(w.document.getElementById("tabTile").getAttribute("aria-selected"), "true");
  assert.equal(w.eval("geometry(getParams()).isTile"), true);
  w.document.getElementById("tabNormal").click();
  assert.equal(w.eval("geometry(getParams()).isTile"), false);
  assert.equal(requests, 0);
  assert.deepEqual(errors, []);
});

test("全アプリをオフライン保存し、統合版の更新で別アプリのキャッシュを消さない", async () => {
  const listeners = new Map();
  const scope = "https://example.test/tools/";
  const prefix = "wood-calculators:/tools/:";
  const stores = new Map([["keraba-v-existing", new Map()], [prefix + "old", new Map()]]);
  const key = (value) => typeof value === "string" ? value : value.url;
  let online = true;
  const cacheApi = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(requests) { for (const req of requests) store.set(req.url, new Response(req.url)); },
        async put(req, response) { store.set(key(req), response); },
        async match(req, options = {}) {
          const strip = (value) => options.ignoreSearch ? value.split("?")[0] : value;
          const found = [...store].find(([url]) => strip(url) === strip(key(req)));
          return found && found[1].clone();
        },
      };
    },
  };
  const context = vm.createContext({
    URL, Request, Response, caches: cacheApi,
    fetch: async () => { if (!online) throw new Error("オフライン"); return new Response("最新"); },
    self: { registration: { scope }, addEventListener: (name, listener) => listeners.set(name, listener), skipWaiting: async () => {}, clients: { claim: async () => {} } },
    importScripts(file) { vm.runInContext(read(file), context); },
  });
  vm.runInContext(read("sw.js"), context);
  for (const name of ["install", "activate"]) {
    let done;
    listeners.get(name)({ waitUntil(promise) { done = promise; } });
    await done;
  }
  assert.equal(stores.has("keraba-v-existing"), true);
  assert.equal(stores.has(prefix + "old"), false);
  const request = async (url, mode) => {
    let response;
    const waits = [];
    const req = mode ? { url, method: "GET", mode } : new Request(url);
    listeners.get("fetch")({ request: req, waitUntil(p) { waits.push(p); }, respondWith(p) { response = p; } });
    if (!response) return null;
    const result = await response;
    await Promise.all(waits);
    return result;
  };
  assert.equal(await (await request(scope + "bolt.html")).text(), "最新");
  online = false;
  for (const file of ["index.html", "bolt.html", "apps/keraba/index.html", "apps/kebiki/index.html", "js/app.js"]) {
    const response = await request(scope + file + "?v=test");
    assert.equal(response.status, 200, file);
  }
  assert.equal((await request(scope, "navigate")).status, 200);
  assert.equal((await request(scope + "missing.html")).status, 503);
  assert.equal(await request("https://example.test/kerabaCut/index.html"), null);
});
