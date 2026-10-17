const {test}=require('node:test');const {testLuts}=require('./luts.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {MediaEngine,identify,probe,settingsFor,hlgCube,run}=require('../src/media.cjs');
const ff='/opt/homebrew/bin/ffmpeg';
const root=path.resolve(__dirname,'..');
test('the HLG conversion keeps black, puts reference white near 90% and keeps grays in order',()=>{
 const lines=hlgCube(33).trim().split('\n'),rows=lines.slice(1).map(l=>l.split(' ').map(Number));
 assert.equal(lines[0],'LUT_3D_SIZE 33');assert.equal(rows.length,33**3);
 assert.deepEqual(rows[0],[0,0,0]);
 const gray=i=>rows[i+i*33+i*33*33];
 for(let i=1;i<33;i++){assert.ok(gray(i)[0]>gray(i-1)[0]);assert.ok(Math.abs(gray(i)[0]-gray(i)[2])<1e-3);}
 assert.ok(Math.abs(gray(24)[0]-.915)<.02,`75% HLG gave ${gray(24)[0]}`);
 assert.equal(gray(32)[0],1);
});
test('DJI BT.709 without a gamma tag remains unknown',()=>{
 assert.equal(identify({encoder:'DJI OsmoPocket3'},{color_transfer:'bt709'}),'Unknown');
 assert.equal(identify({'com.dji.camera.ColorGammaSxS':'D-Log2'},{color_transfer:'bt709'}),'D-Log2');
 assert.equal(identify({'com.dji.camera.ColorGammaSxS':'Rec.709'},{color_transfer:'bt709'}),'Normal');
 assert.equal(identify({},{color_transfer:'arib-std-b67'}),'HLG');
});
test('real processing, mixed profiles, trims, metadata, persistence and collision safety',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pocket-test-'));
 const source=path.join(temp,'source');await fs.mkdir(source);
 const output=path.join(temp,'exports');
 const file=path.join(source,'ramp.mp4');
 await run(ff,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=2','-f','lavfi','-i','sine=frequency=600:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-color_trc','bt709','-colorspace','bt709','-color_primaries','bt709','-c:a','aac',file]);
 const engine=new MediaEngine({dataDir:path.join(temp,'data'),lutDir:await testLuts()});await engine.init();
 const {clips}=await engine.scan(source);assert.equal(clips.length,1);const c=clips[0];
 const unknown={...c,id:'unknown',profile:'Unknown'};engine.clips.push(unknown);
 await assert.rejects(()=>engine.export({ids:['unknown'],output}),/Choose the recorded/);
 const hdr={...c,id:'hdr',profile:'HLG'};engine.clips.push(hdr);
 assert.match(await engine.frame({id:'hdr',time:.5,settings:{exposure:.5}}),/^data:image\/png;base64,/);
 assert.match(await engine.lut(hdr,settingsFor(hdr,{lutStrength:0})),/hlgv1-100-v2\.cube$/);
 for(const profile of ['D-Log','D-Log2','D-Log M']){
  for(const strength of [0,50,100]){const result=await engine.frame({id:c.id,time:.5,settings:{profile,lutStrength:strength,exposure:2,saturation:30,brilliance:30,warmth:10,tint:-10,shadows:20,highlights:-20,contrast:10}});assert.match(result,/^data:image\/png;base64,/);}
 }
 const edit={profile:'Normal',trimStart:.3,trimEnd:1.3,mute:true,exposure:-.4};
 await engine.save({edits:{[c.id]:edit}});
 await engine.export({ids:[c.id],output,options:{resolution:720},edits:{[c.id]:edit}});await engine.exportPromise;
 assert.equal(engine.jobs.items[0].status,'done',engine.jobs.items[0].error);
 const dest=engine.jobs.items[0].path;const first=await fs.readFile(dest);
 const metadata=JSON.parse(await run('/opt/homebrew/bin/ffprobe',['-v','error','-show_streams','-show_format','-of','json',dest]));
 assert.ok(Math.abs(Number(metadata.format.duration)-1)<.1);assert.equal(metadata.streams.length,1);assert.equal(metadata.streams[0].color_transfer,'bt709');
 assert.equal(metadata.streams[0].width,320);
 await engine.export({ids:[c.id],output,options:{resolution:720}});await engine.exportPromise;assert.equal(engine.jobs.items[0].status,'done');assert.notEqual(engine.jobs.items[0].path,dest);assert.deepEqual(await fs.readFile(dest),first);
 const restored=new MediaEngine({dataDir:path.join(temp,'data'),lutDir:await testLuts()});await restored.init();assert.equal(restored.edits[c.id].exposure,-.4);assert.equal(restored.exportRecords[c.id].path,engine.jobs.items[0].path);
 await assert.rejects(()=>engine.export({ids:[c.id],output:source}),/outside the source/);
 assert.match((await engine.sourceVideo(c.id)).url,/^file:/);
 const curve=await engine.tonalLut({settings:{brilliance:20}});assert.equal(Buffer.from(curve.data,'base64').length,65536*2);
 assert.equal((await fs.readdir(source)).length,1);
 await fs.rm(temp,{recursive:true,force:true});
});
test('LUT strength blends every entry, including scientific notation',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pocket-lut-'));
 const luts=await testLuts(),e=new MediaEngine({dataDir:temp,lutDir:luts});await e.init();
 const c={profile:'D-Log2',duration:1};const s=settingsFor(c,{lutStrength:65});
 const out=await e.lut(c,s);
 const rows=text=>text.split(/\r?\n/).map(x=>x.trim().split(/\s+/).map(Number)).filter(x=>x.length===3&&x.every(Number.isFinite));
 const text=await fs.readFile(path.join(luts,'dlog2.cube'),'utf8'),n=Number(text.match(/LUT_3D_SIZE (\d+)/)[1]);
 assert.match(text,/\de-\d/);const src=rows(text),mix=rows(await fs.readFile(out,'utf8'));
 assert.equal(mix.length,n**3);
 for(let i=0;i<src.length;i+=7){const identity=[i%n,Math.floor(i/n)%n,Math.floor(i/n/n)].map(x=>x/(n-1));for(let j=0;j<3;j++)assert.ok(Math.abs(mix[i][j]-(src[i][j]*.65+identity[j]*.35))<1e-7);}
 await fs.rm(temp,{recursive:true,force:true});
});
test('concurrent export guard, cancellation cleanup and source descendants',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pocket-cancel-'));const source=path.join(temp,'source');await fs.mkdir(source);
 const file=path.join(source,'clip.mp4');await run(ff,['-v','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=30:duration=5','-c:v','h264_videotoolbox','-b:v','1000000','-color_trc','bt709',file]);
 const e=new MediaEngine({dataDir:path.join(temp,'data'),lutDir:await testLuts()});await e.init();await e.scan(source);const ids=[e.clips[0].id];e.edits[ids[0]]={profile:'Normal'};
 const nested=path.join(source,'should-not-exist');await assert.rejects(()=>e.export({ids,output:nested}),/outside the source/);assert.equal(await fs.access(nested).then(()=>true,()=>false),false);
 const output=path.join(temp,'exports');const first=e.export({ids,output});await assert.rejects(()=>e.export({ids,output}),/already running/);await first;e.cancelExport();await e.exportPromise;
 assert.equal(e.jobs.state,'cancelled');assert.deepEqual(e.exportRecords,{});assert.equal((await fs.readdir(output)).length,0);
 await fs.rm(temp,{recursive:true,force:true});
});
test('thumbnails come from the fast keyframe path and fall back when it finds no frame',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pocket-thumb-'));
 try{
  const source=path.join(temp,'source');await fs.mkdir(source);
  // One keyframe at the start: the keyframe-only read after 20% finds nothing, so the
  // software fallback must still produce a thumbnail.
  await run(ff,['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=3','-c:v','libx264','-g','1000','-pix_fmt','yuv420p','-y',path.join(source,'onekey.mp4')]);
  await run(ff,['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=3','-c:v','libx264','-g','15','-pix_fmt','yuv420p','-y',path.join(source,'gop.mp4')]);
  const e=new MediaEngine({dataDir:path.join(temp,'data'),lutDir:await testLuts()});await e.init();await e.scan(source);
  for(const c of e.clips){const url=await e.thumbnail(c.id);assert.match(url,/^data:image\/jpeg;base64,/);assert.ok(url.length>2000,c.name);}
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('a graded clip gets its own thumbnail, and only its newest one is kept',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pocket-thumb-grade-'));
 try{
  const source=path.join(temp,'source');await fs.mkdir(source);
  await run(ff,['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=3','-c:v','libx264','-g','15','-pix_fmt','yuv420p','-y',path.join(source,'clip.mp4')]);
  const e=new MediaEngine({dataDir:path.join(temp,'data'),lutDir:await testLuts()});await e.init();await e.scan(source);
  const id=e.clips[0].id,thumbs=async()=>(await fs.readdir(e.cache)).filter(n=>n.endsWith('-thumb.jpg')).sort();
  const plain=await e.thumbnail({id,settings:{profile:'Normal'}});
  // A hand-set profile that matches the file looks the same, so it reuses the plain thumbnail.
  assert.equal(await e.thumbnail({id,settings:{profile:e.clips[0].profile}}),await e.thumbnail(id));
  const warm=await e.thumbnail({id,settings:{profile:'Normal',warmth:80}});assert.notEqual(warm,plain);
  const cool=await e.thumbnail({id,settings:{profile:'Normal',warmth:-80}});assert.notEqual(cool,warm);
  const names=await thumbs();assert.equal(names.length,2,names.join());assert.ok(names.includes(`${id}-thumb.jpg`));
  // Trim moves the picture to the new start.
  await e.thumbnail({id,settings:{profile:'Normal',warmth:-80,trimStart:2}});assert.equal((await thumbs()).length,2);
  assert.ok((await e.cacheBytes())>0);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
