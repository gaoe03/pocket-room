const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {run}=require('../src/media.cjs');
// Settings through the real UI: gear and Cmd+, entry points, shared autoplay in the editor
// preview, LUT status, clearing the cache, and the preference surviving a relaunch.
(async()=>{
 const data=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pocket-settings-ui-')));const source=path.join(data,'clips');await fs.mkdir(source);
 for(const n of [1,2,3])await run('/opt/homebrew/bin/ffmpeg',['-v','error','-f','lavfi','-i',`testsrc2=size=320x180:rate=30:duration=1.5`,'-vf','setparams=color_trc=bt709:colorspace=bt709:color_primaries=bt709','-c:v','libx264','-pix_fmt','yuv420p','-y',path.join(source,`clip${n}.mp4`)]);
 await fs.writeFile(path.join(data,'library.json'),JSON.stringify({clips:[],edits:{},source,view:{projectId:'',sort:'oldest'}}));
 const executablePath=process.env.POCKET_SOURCE?undefined:process.env.POCKET_PACKAGED?'/Applications/Pocket Room.app/Contents/MacOS/Pocket Room':path.resolve('dist/Pocket Room-darwin-arm64/Pocket Room.app/Contents/MacOS/Pocket Room');
 const launch=()=>electron.launch({...(executablePath?{executablePath}:{args:[path.resolve('.')]}),env:{...process.env,POCKET_TEST_DATA:data}});
 const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
 let app=await launch(),p=await app.firstWindow();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const active=()=>p.evaluate(()=>document.querySelector('.clip-card.active')?.title);
 const playing=()=>p.waitForFunction(()=>!document.querySelector('#preview-video').paused,null,{timeout:15000});
 try{
  await p.locator('#rescan-button').click();await p.waitForFunction(()=>document.querySelectorAll('.clip-card').length===3,null,{timeout:30000});
  await p.waitForFunction(()=>window.pocketPreview?.video.readyState>=2);
  await p.locator('#settings-button').click();await p.waitForFunction(()=>document.querySelector('#settings-version').textContent);
  assert.equal(await p.locator('#settings-version').innerText(),'Version '+version);
  assert.equal(await p.locator('#setting-autoplay').isChecked(),true);
  assert.deepEqual(await p.$$eval('#settings-luts li span',s=>s.map(x=>x.textContent)),['D-Log2','D-Log2 vivid','D-Log','D-Log M']);
  await p.screenshot({path:path.join(data,'settings.png')});
  await p.locator('#settings-cancel').click();
  // Autoplay on: the first clip ends and the second starts on its own.
  assert.equal(await active(),'clip1.mp4');await p.locator('#play-preview').click();await playing();
  // A busy audio device can leave audio wake-up pending forever. The next clip must still play.
  await p.evaluate(()=>{window.pocketPreview.audio.resume=()=>new Promise(()=>{});});
  await p.waitForFunction(()=>document.querySelector('.clip-card.active')?.title==='clip2.mp4',null,{timeout:15000});await playing();
  // Turn it off from the app menu entry, then let clip 2 finish.
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label==='Settings…').click());
  await p.waitForFunction(()=>document.querySelector('#settings-dialog').open);
  // Unchecking does nothing until Save.
  await p.locator('#setting-autoplay').click();assert.equal(await p.locator('#stream-autoplay').isChecked(),true);
  await p.waitForFunction(()=>!/Checking/.test(document.querySelector('#settings-cache').textContent));
  await p.locator('#clear-cache').click();await p.waitForFunction(()=>/No thumbnails/.test(document.querySelector('#settings-cache').textContent));
  await p.locator('#settings-save').click();assert.equal(await p.evaluate(()=>document.querySelector('#settings-dialog').open),false);
  assert.equal(await p.locator('#stream-autoplay').isChecked(),false);
  // Esc discards unsaved edits.
  await p.locator('#settings-button').click();await p.waitForFunction(()=>document.querySelector('#settings-dialog').open);
  await p.locator('#setting-autoplay').click();await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(()=>document.querySelector('#settings-dialog').open),false);assert.equal(await p.locator('#stream-autoplay').isChecked(),false);
  await p.waitForFunction(()=>document.querySelector('#preview-video').paused,null,{timeout:15000});await p.waitForTimeout(800);
  assert.equal(await active(),'clip2.mp4','autoplay off still advanced');
  await p.evaluate(()=>window.pocketFlush());await app.close();
  const saved=JSON.parse(await fs.readFile(path.join(data,'library.json'),'utf8'));assert.equal(saved.preferences.autoplay,false);
  const log=await fs.readFile(path.join(data,'autoplay.log'),'utf8').catch(()=>'');
  if(!process.env.POCKET_OLD)for(const line of ['end clip1.mp4 autoplay=true','next clip2.mp4','playing clip2.mp4'])assert.ok(log.includes(line),'autoplay log is missing '+line);
  app=await launch();p=await app.firstWindow();p.on('pageerror',e=>errors.push(e.message));await p.waitForSelector('.clip-card');
  assert.equal(await p.locator('#stream-autoplay').isChecked(),false);
  await p.keyboard.press('Meta+Comma').catch(()=>{});
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label==='Settings…').click());
  await p.waitForFunction(()=>document.querySelector('#settings-dialog').open);assert.equal(await p.locator('#setting-autoplay').isChecked(),false);
  // Restore defaults fills the form. Save applies it.
  await p.locator('#settings-reset').click();assert.equal(await p.locator('#setting-autoplay').isChecked(),true);assert.equal(await p.locator('#stream-autoplay').isChecked(),false);
  await p.locator('#settings-save').click();assert.equal(await p.locator('#stream-autoplay').isChecked(),true);
  assert.deepEqual(errors,[]);console.log('PASS settings, shared autoplay, LUT status, clear cache, saved preference '+data);
 }finally{await app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exit(1);});
