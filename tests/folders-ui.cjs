const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {run}=require('../src/media.cjs');
// Folder trips and nested chapters through the real UI: Rescan, trip menu, chapter chips
// that count nested folders, chapter filtering, Select range scopes and the Manage note.
(async()=>{
 const data=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pocket-folders-ui-')));const source=path.join(data,'DCIM');
 const clip=async(rel,n)=>{const file=path.join(source,rel,`DJI_2026091510${String(n).padStart(4,'0')}_${String(n).padStart(4,'0')}_D.MP4`);await fs.mkdir(path.dirname(file),{recursive:true});await run('/opt/homebrew/bin/ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=30:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-y',file]);};
 await clip('18 Autumn Trip/01 Old Town',1);await clip('18 Autumn Trip/01 Old Town/Day 2',2);await clip('18 Autumn Trip/03 Harbor',3);await clip('16 NYC:LA/02 Beach',4);await clip('17 Road Trip',5);
 await fs.writeFile(path.join(data,'library.json'),JSON.stringify({clips:[],edits:{},source,view:{projectId:'',sort:'number'}}));
 const executablePath=process.env.POCKET_SOURCE?undefined:process.env.POCKET_PACKAGED?'/Applications/Pocket Room.app/Contents/MacOS/Pocket Room':path.resolve('dist/Pocket Room-darwin-arm64/Pocket Room.app/Contents/MacOS/Pocket Room');
 const app=await electron.launch({...(executablePath?{executablePath}:{args:[path.resolve('.')]}),env:{...process.env,POCKET_TEST_DATA:data}});
 const p=await app.firstWindow();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const chips=()=>p.$$eval('.chapter-chip',b=>b.map(x=>x.textContent.trim().replace(/\s+/g,' ')));
 const cards=()=>p.locator('.clip-card').count();
 try{
  await p.locator('#rescan-button').click();await p.waitForFunction(()=>document.querySelectorAll('.clip-card').length===5,null,{timeout:30000});
  assert.deepEqual(await p.$$eval('#project-filter option',o=>o.map(x=>x.textContent)),['All trips','16 NYC/LA','17 Road Trip','18 Autumn Trip']);
  await p.locator('#project-filter').selectOption({label:'18 Autumn Trip'});
  assert.deepEqual(await chips(),['All 3','01 Old Town 2','01 Old Town / Day 2 1','03 Harbor 1']);
  await p.locator('.chapter-chip',{hasText:/^01 Old Town 2$/}).click();assert.equal(await cards(),2);
  await p.locator('.chapter-chip',{hasText:'Day 2'}).click();assert.equal(await cards(),1);
  await p.locator('#project-filter').selectOption({label:'17 Road Trip'});assert.deepEqual(await chips(),['All 1']);assert.equal(await cards(),1);
  await p.locator('#project-filter').selectOption({label:'18 Autumn Trip'});
  await p.locator('#open-selection').click();await p.locator('#selection-scope').selectOption({label:'01 Old Town'});
  assert.match(await p.locator('#selection-match-count').innerText(),/2/);await p.locator('#add-selection').click();
  assert.match(await p.locator('#selection-summary').innerText(),/2/);
  await p.locator('#manage-library').click();
  assert.equal(await p.locator('.folder-note').isVisible(),true);assert.equal(await p.locator('#project-list').isVisible(),false);
  assert.match(await p.locator('#library-dialog-intro').innerText(),/subfolders/);
  await p.screenshot({path:path.join(data,'manage.png')});await p.locator('#library-dialog footer button').click();
  await p.screenshot({path:path.join(data,'folders.png')});
  await p.evaluate(()=>window.pocketFlush());
  const saved=JSON.parse(await fs.readFile(path.join(data,'library.json')));
  assert.equal(saved.organization.folders,true);assert.ok(saved.organization.projects.find(x=>x.name==='18 Autumn Trip').chapters.some(c=>c.parentId));
  assert.deepEqual(errors,[]);
  // A saved trip that no longer exists falls back to all clips on the next launch.
  await app.close();saved.view={...saved.view,projectId:'missing-trip',chapterId:'missing-chapter'};await fs.writeFile(path.join(data,'library.json'),JSON.stringify(saved));
  const again=await electron.launch({...(executablePath?{executablePath}:{args:[path.resolve('.')]}),env:{...process.env,POCKET_TEST_DATA:data}});
  try{const q=await again.firstWindow();await q.waitForFunction(()=>document.querySelectorAll('.clip-card').length===5,null,{timeout:30000});assert.equal(await q.locator('#project-filter').inputValue(),'');}finally{await again.close();}
  console.log('PASS folder trips, nested chapters, filters, selection, manage note, stale trip fallback '+data);
 }finally{await app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exit(1);});
