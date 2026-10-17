const {test}=require('node:test');const {testLuts}=require('./luts.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {cleanOrganization,defaultView,clipNumber,captureTime,orderedClips}=require('../src/library.js');
const {MediaEngine}=require('../src/media.cjs');
function clip(n,date='20260912120000'){
 const name=`DJI_${date}_${String(n).padStart(4,'0')}_D.MP4`;
 return {id:'clip'+n,name,path:'/Volumes/CARD/DCIM/DJI_001/'+name,duration:n,profile:'Unknown'};
}
const trips=()=>({projects:[{id:'coast',name:'Coast trip',chapters:[{id:'north',name:'North'},{id:'south',name:'South'}]}],assignments:{clip107:{projectId:'coast',chapterId:'north'},clip111:{projectId:'coast',chapterId:'south'}},favorites:['clip169']});
test('manual trips keep custom names, assignments and favorites, and drop invalid ones',()=>{
 const org=trips();
 assert.deepEqual(cleanOrganization(org),org);
 const cleaned=cleanOrganization({...org,assignments:{...org.assignments,invalid:{projectId:'not-found',chapterId:'north'},moved:{projectId:'coast',chapterId:'gone'}},favorites:[...org.favorites,'bad id!']});
 assert.deepEqual(cleaned.assignments.invalid,{projectId:'',chapterId:''});
 assert.deepEqual(cleaned.assignments.moved,{projectId:'coast',chapterId:''});
 assert.deepEqual(cleaned.favorites,['clip169']);
 assert.deepEqual(defaultView(),{projectId:'',chapterId:'',sort:'oldest'});
 assert.equal(clipNumber(clip(107)),107);assert.equal(clipNumber({name:'video.mp4'}),null);
});
test('capture times retain camera wall time and sorting has stable ties',()=>{
 const a=clip(169,'20260915085741'),b=clip(170,'20260915085805'),c={...clip(2,'20260907060000'),duration:170};
 assert.equal(captureTime(a),'2026-09-15T08:57:41');
 assert.deepEqual(orderedClips([b,c,a],'oldest').map(c=>c.id),['clip2','clip169','clip170']);
 assert.deepEqual(orderedClips([b,c,a],'newest').map(c=>c.id),['clip170','clip169','clip2']);
 assert.deepEqual(orderedClips([b,c,a],'shortest').map(c=>c.id),['clip169','clip2','clip170']);
});
test('saved edits, manual trips and view survive a reopen',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pocket-library-'));
 try {
 const c=clip(169),edits={[c.id]:{profile:'D-Log',lutStrength:61,exposure:.3,trimStart:1,trimEnd:3}};
 const org={...trips(),assignments:{[c.id]:{projectId:'coast',chapterId:'south'}}};
 await fs.writeFile(path.join(dir,'library.json'),JSON.stringify({exposureScale:'stops',clips:[c],edits,organization:org,source:'/Volumes/CARD/DCIM/DJI_001',output:'/tmp/my-exports',exportSettings:{resolution:1080}}));
 const e=new MediaEngine({dataDir:dir,lutDir:await testLuts()});const initial=await e.init();
 assert.deepEqual(initial.edits,edits);assert.equal(initial.output,'/tmp/my-exports');assert.equal(initial.organization.assignments[c.id].chapterId,'south');
 initial.organization.favorites=[c.id];initial.organization.projects[0].name='Renamed trip';
 const view={projectId:'coast',chapterId:'south',sort:'newest',activeId:c.id,selected:[c.id],playhead:2.4};
 await e.save({organization:initial.organization,view});
 const restored=await new MediaEngine({dataDir:dir,lutDir:await testLuts()}).init();
 assert.deepEqual(restored.edits,edits);assert.deepEqual(restored.view,view);assert.equal(restored.organization.projects[0].name,'Renamed trip');assert.deepEqual(restored.organization.favorites,[c.id]);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('exposure saved before 0.4 becomes stops once',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pocket-library-'));
 try {
 const c=clip(169);
 await fs.writeFile(path.join(dir,'library.json'),JSON.stringify({clips:[c],edits:{[c.id]:{profile:'D-Log',exposure:.3}}}));
 const first=await new MediaEngine({dataDir:dir,lutDir:await testLuts()}).init();
 assert.equal(first.edits[c.id].exposure,.72);
 const again=await new MediaEngine({dataDir:dir,lutDir:await testLuts()}).init();
 assert.equal(again.edits[c.id].exposure,.72);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('export quality labels from the interface set different encoding budgets',async()=>{
 const engine=new MediaEngine({dataDir:'/tmp',lutDir:await testLuts()});
 const clip={path:'/unused',width:1920,height:1080};const settings={trimStart:0,trimEnd:1};
 const rates=[];engine.process=async args=>{rates.push(Number(args[args.indexOf('-b:v')+1]));};
 for(const quality of ['smaller','balanced','best'])await engine.encode(clip,settings,null,'/unused',{resolution:1080,quality});
 assert.deepEqual(rates,[3600000,6000000,9600000]);
});
