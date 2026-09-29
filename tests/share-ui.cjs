const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {run}=require('../src/media.cjs');
// Share through the real UI: after an export the button offers the batch, edits make an
// export outdated, and moved files are reported. Test runs return the files instead of
// opening the native share menu, so nothing appears on screen.
(async()=>{
 const data=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pocket-share-ui-')));const source=path.join(data,'clips'),output=path.join(data,'exports');await fs.mkdir(source);
 for(const n of [1,2])await run('/opt/homebrew/bin/ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=1','-f','lavfi','-i','sine=frequency=500:duration=1','-vf','setparams=color_trc=bt709:colorspace=bt709:color_primaries=bt709','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',path.join(source,`clip${n}.mp4`)]);
 await fs.writeFile(path.join(data,'library.json'),JSON.stringify({clips:[],edits:{},source,output,view:{projectId:'',sort:'oldest'}}));
 const executablePath=process.env.POCKET_SOURCE?undefined:process.env.POCKET_PACKAGED?'/Applications/Pocket Room.app/Contents/MacOS/Pocket Room':path.resolve('dist/Pocket Room-darwin-arm64/Pocket Room.app/Contents/MacOS/Pocket Room');
 const app=await electron.launch({...(executablePath?{executablePath}:{args:[path.resolve('.')]}),env:{...process.env,POCKET_TEST_DATA:data}});
 const p=await app.firstWindow();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const share=()=>p.evaluate(()=>window.pocket.share({ids:[...document.querySelectorAll('.clip-card')].map(c=>c.dataset.id),x:0,y:0}).catch(e=>({error:e.message})));
 try{
  await p.locator('#rescan-button').click();await p.waitForFunction(()=>document.querySelectorAll('.clip-card').length===2,null,{timeout:30000});
  for(const box of await p.locator('.clip-check input').all())await box.check();
  await p.locator('#export-tab').click();assert.equal(await p.locator('#share-exports').isVisible(),false);
  assert.match((await share()).error,/Export the selected clips first/);
  await p.locator('#start-export').click();await p.waitForFunction(()=>/complete/i.test(document.querySelector('#export-state').textContent),null,{timeout:60000});
  await p.waitForFunction(()=>!document.querySelector('#share-exports').classList.contains('hidden'));
  assert.equal((await p.locator('#share-exports').innerText()).trim(),'Share 2 clips');
  await p.screenshot({path:path.join(data,'share.png')});
  let result=await share();assert.equal(result.count,2);assert.ok(result.paths.every(f=>f.startsWith(output)));
  await p.locator('#share-exports').click();await p.waitForTimeout(300);assert.equal(await p.locator('.toast.error').count(),0);
  // An edit makes that clip's export outdated, so it leaves the share.
  await p.locator('#edit-tab').click();await p.locator('[data-setting="exposure"]').fill('0.5');await p.locator('[data-setting="exposure"]').dispatchEvent('change');
  await p.locator('#export-tab').click();await p.waitForFunction(()=>document.querySelector('#share-exports').textContent.trim()==='Share 1 clip');
  await p.evaluate(()=>window.pocketFlush());result=await share();assert.equal(result.count,1);
  // A moved export is reported instead of failing the share.
  await fs.rename(result.paths[0],path.join(data,'moved.mp4'));result=await share();assert.match(result.error,/moved or deleted/);
  assert.deepEqual(errors,[]);console.log('PASS share after export, outdated exports left out, moved files reported '+data);
 }finally{await app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exit(1);});
