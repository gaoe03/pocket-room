const {test}=require('node:test');const {testLuts}=require('./luts.cjs');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {MediaEngine,run}=require('../src/media.cjs');const {inChapter}=require('../src/library.js');
const root=path.resolve(__dirname,'..');
const clip=async file=>{await fs.mkdir(path.dirname(file),{recursive:true});await run('/opt/homebrew/bin/ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=30:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-y',file]);};
test('folders become trips and nested chapters, and moved clips keep their edits',async()=>{
 const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'pocket-folders-')));
 try{
  const source=path.join(temp,'DCIM');
  await clip(path.join(source,'18 Autumn Trip','03 Harbor','DJI_20260915102650_0200_D.MP4'));
  await clip(path.join(source,'18 Autumn Trip','01 Old Town','Day 1','DJI_20260908101010_0107_D.MP4'));
  await clip(path.join(source,'16 NYC:LA','02 Beach','DJI_20260101101010_0001_D.MP4'));
  await clip(path.join(source,'17 Road Trip','DJI_20260901101010_0050_D.MP4'));
  await clip(path.join(source,'DJI_001','DJI_20260920101010_0500_D.MP4'));
  await fs.writeFile(path.join(source,'18 Autumn Trip','03 Harbor','._DJI_20260915102650_0200_D.MP4'),'appledouble');
  await fs.mkdir(path.join(source,'.Trashes'));await clip(path.join(source,'.Trashes','DJI_20260101000000_0999_D.MP4'));
  const engine=new MediaEngine({dataDir:path.join(temp,'data'),lutDir:await testLuts()});await engine.init();
  const first=await engine.scan(source);
  assert.deepEqual(first.errors,[]);assert.equal(first.clips.length,5);
  const org=first.organization;assert.equal(org.folders,true);
  assert.deepEqual(org.projects.map(p=>p.name),['16 NYC/LA','17 Road Trip','18 Autumn Trip','DJI_001']);
  const sep=org.projects.find(p=>p.name==='18 Autumn Trip');
  assert.deepEqual(sep.chapters.map(c=>c.name),['01 Old Town','01 Old Town / Day 1','03 Harbor']);
  const hk=sep.chapters.find(c=>c.name==='01 Old Town'),day=sep.chapters.find(c=>c.name==='01 Old Town / Day 1');
  assert.equal(day.parentId,hk.id);
  const byNumber=n=>first.clips.find(c=>c.name.includes('_'+n+'_'));
  const nested=org.assignments[byNumber('0107').id];assert.equal(nested.chapterId,day.id);
  assert.equal(inChapter(org,nested,hk.id),true);assert.equal(inChapter(org,nested,sep.chapters.find(c=>c.name==='03 Harbor').id),false);
  assert.equal(org.assignments[byNumber('0050').id].chapterId,'');
  // Edit, favorite and move a clip, then rescan.
  const moved=byNumber('0200');
  await engine.save({edits:{[moved.id]:{profile:'D-Log2',exposure:.4,trimEnd:.5}},organization:{...org,favorites:[moved.id]}});
  assert.equal(engine.organization.folders,true);assert.equal(engine.organization.projects.find(p=>p.id===sep.id).chapters.find(c=>c.id===day.id).parentId,hk.id);
  const target=path.join(source,'18 Autumn Trip','02 Market');await fs.mkdir(target);
  await fs.rename(moved.path,path.join(target,moved.name));
  const second=await engine.scan(source);
  const after=second.clips.find(c=>c.name===moved.name);
  assert.equal(after.id,moved.id);assert.equal(after.path,path.join(target,moved.name));
  assert.equal(engine.edits[moved.id].exposure,.4);assert.deepEqual(second.organization.favorites,[moved.id]);
  const market=second.organization.projects.find(p=>p.id===sep.id).chapters.find(c=>c.name==='02 Market');
  assert.equal(second.organization.assignments[moved.id].chapterId,market.id);
  // Reopening the saved library keeps the folder mode and the nested chapter link.
  const reopened=new MediaEngine({dataDir:path.join(temp,'data'),lutDir:await testLuts()});const snap=await reopened.init();
  assert.equal(snap.organization.folders,true);assert.equal(snap.organization.projects.find(p=>p.id===sep.id).chapters.find(c=>c.id===day.id).parentId,hk.id);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
