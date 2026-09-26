const {test}=require('node:test');const {testLuts}=require('./luts.cjs');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {MediaEngine}=require('../src/media.cjs');
const root=path.resolve(__dirname,'..');
const old=new Date(Date.now()-30*864e5);
test('launch survives old Chromium cache folders and prunes only owned files',async()=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'pocket-cache-'));
 try{
  // Chromium's Cache and our old cache are the same folder on a case-insensitive disk.
  const legacy=path.join(data,'cache');
  for(const dir of ['No_Vary_Search','Cache_Data'])await fs.mkdir(path.join(legacy,dir),{recursive:true});
  await fs.writeFile(path.join(legacy,'Cache_Data','index'),'chromium');
  await fs.writeFile(path.join(legacy,'0123456789abcdef01234567-thumb.jpg'),'thumb');
  await fs.writeFile(path.join(legacy,'curve-ramp16.rgb'),'ramp');
  for(const n of ['No_Vary_Search','Cache_Data'])await fs.utimes(path.join(legacy,n),old,old);
  const current=path.join(data,'media-cache');await fs.mkdir(path.join(current,'stray-folder'),{recursive:true});
  for(const n of ['89abcdef0123456789abcdef-thumb.jpg','dlog2-40-v2.cube','notes.txt'])await fs.writeFile(path.join(current,n),'x');
  await fs.writeFile(path.join(current,'fedcba9876543210fedcba98-thumb.jpg'),'fresh');
  for(const n of ['89abcdef0123456789abcdef-thumb.jpg','dlog2-40-v2.cube','notes.txt','stray-folder'])await fs.utimes(path.join(current,n),old,old);
  const engine=new MediaEngine({dataDir:data,lutDir:await testLuts()});
  const snapshot=await engine.init();assert.equal(Array.isArray(snapshot.clips),true);
  assert.deepEqual((await fs.readdir(legacy)).sort(),['Cache_Data','No_Vary_Search']);
  assert.equal(await fs.readFile(path.join(legacy,'Cache_Data','index'),'utf8'),'chromium');
  assert.deepEqual((await fs.readdir(current)).sort(),['fedcba9876543210fedcba98-thumb.jpg','notes.txt','stray-folder']);
 }finally{await fs.rm(data,{recursive:true,force:true});}
});
