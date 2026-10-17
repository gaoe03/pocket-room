const fs = require('node:fs/promises');
const {signature,exportOptions}=require('./adjustments.js');
const {cleanOrganization,defaultView} = require('./library.js');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const FFMPEG = process.env.POCKET_FFMPEG || '/opt/homebrew/bin/ffmpeg';
const FFPROBE = process.env.POCKET_FFPROBE || '/opt/homebrew/bin/ffprobe';
const OWNED_CACHE = /^(?:[0-9a-f]{24}(?:(?:-[0-9a-f]{12})?-thumb\.jpg|\.mp4)|[A-Za-z0-9]+-\d+-v2\.cube|curve-ramp16\.rgb)$/;
const EXPOSURE_KNEE = .5;
const PROFILES = ['auto','D-Log2','D-Log','D-Log M','Normal','Unknown','HLG'];
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
const clamp = (n,min,max,fallback=0) => Number.isFinite(Number(n)) ? Math.min(max,Math.max(min,Number(n))) : fallback;
function run(binary,args,{signal,onProgress}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{stdio:['ignore','pipe','pipe'],signal});
    const chunks=[]; let error='';
    child.stdout.on('data',b=>{chunks.push(b); if(onProgress)onProgress(b.toString());});
    child.stderr.on('data',b=>{error=(error+b.toString()).slice(-5000);});
    let processError;child.on('error',error=>{processError=error;});
    child.on('close',code=>code===0&&!processError?resolve(Buffer.concat(chunks)):reject(processError||new Error(signal?.aborted?'Cancelled':error||`Video processing exited (${code})`)));
  });
}
function identify(tags,stream) {
  const raw=tags['com.dji.camera.ColorGammaSxS'];
  const mode={'D-Log2':'D-Log2','D-Log 2':'D-Log2','D-Log':'D-Log','D-Log M':'D-Log M','Rec.709':'Normal','HLG':'HLG'}[raw];
  if (stream.color_transfer==='arib-std-b67'||stream.color_transfer==='smpte2084') return 'HLG';
  if(mode)return mode;
  return /DJI|Osmo/i.test(tags.encoder||'')?'Unknown':stream.color_transfer==='bt709'?'Normal':'Unknown';
}
// Pocket 3 files carry no color tag. The camera records the mode in its "DJI meta" track,
// a protobuf where field 2.4.1 is 19 for D-Log M and 9 for HLG. With no 2.4.1, field
// 2.3.5 is 8 for Normal. Anything else stays Unknown.
function protobufVarints(buffer,prefix='',out=new Map(),depth=0){
  let i=0;const varint=()=>{let value=0,shift=0,byte;do{if(i>=buffer.length)throw new RangeError('truncated');byte=buffer[i++];value+=(byte&127)*2**shift;shift+=7;}while(byte&128);return value;};
  while(i<buffer.length){
    const key=varint(),field=Math.floor(key/8),type=key%8,name=prefix+field;if(!field)throw new RangeError('bad field');
    if(type===0){const value=varint();if(!out.has(name))out.set(name,value);}
    else if(type===2){const length=varint(),body=buffer.subarray(i,i+length);if(i+length>buffer.length)throw new RangeError('truncated');i+=length;
      if(depth<6){const nested=new Map();try{protobufVarints(body,name+'.',nested,depth+1);for(const [k,v] of nested)if(!out.has(k))out.set(k,v);}catch{}}}
    else if(type===1)i+=8;else if(type===5)i+=4;else throw new RangeError('bad wire type');
  }
  return out;
}
function pocket3Mode(fields){
  const mode=fields.get('2.4.1');
  if(mode===19)return 'D-Log M';if(mode===9)return 'HLG';
  if(mode===undefined&&fields.get('2.3.5')===8)return 'Normal';
  return 'Unknown';
}
async function pocket3Profile(file){
  try{return pocket3Mode(protobufVarints(await run(FFMPEG,['-v','error','-i',file,'-map','0:m:handler_name:DJI meta','-frames:d','1','-c','copy','-f','data','-'])));}
  catch{return 'Unknown';}
}
// Stored clip metadata from an older probe is read again once.
const PROBE_VERSION=2;
async function probe(file) {
  const stat=await fs.stat(file);
  const j=JSON.parse(await run(FFPROBE,['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate,color_transfer,color_primaries:format=duration:format_tags=encoder,creation_time,com.dji.camera.ColorGammaSxS,com.dji.camera.LensType','-of','json',file]));
  const s=j.streams[0],t=j.format.tags||{};
  if(!s||!Number(j.format.duration))throw new Error('No playable video');
  const fps=s.r_frame_rate.split('/').map(Number);
  let profile=identify(t,s);if(profile==='Unknown'&&/OsmoPocket3/i.test(t.encoder||''))profile=await pocket3Profile(file);
  return {probe:PROBE_VERSION,id:hash([file,stat.size,stat.mtimeMs]),path:file,name:path.basename(file),size:stat.size,mtimeMs:stat.mtimeMs,duration:Number(j.format.duration),width:s.width,height:s.height,fps:fps[0]/fps[1],camera:t.encoder||'Video',profile,date:(path.basename(file).match(/DJI_(\d{4})(\d{2})(\d{2})/)||[]).slice(1).join('-')||t.creation_time?.slice(0,10)||'',lens:t['com.dji.camera.LensType']||''};
}
// HLG to SDR as a 3D LUT, so HLG runs through the same LUT stage as the DJI log profiles.
// Input is full-range BT.2020 RGB with the HLG curve (ARIB STD-B67). HLG reference white
// (75% signal, 203 nits on a 1000 nit display) lands near 90% SDR, brighter parts roll off
// toward white, and BT.2020 colors are converted to BT.709. Output is display RGB, gamma 2.4.
function hlgCube(size=65){
  const a=.17883277,b=.28466892,c=.55991073,white=.203,knee=.6;
  const linear=e=>e<=.5?e*e/3:(Math.exp((e-c)/a)+b)/12;
  const peak=1/white,k=(peak-knee)/(1-knee);
  const lines=[`LUT_3D_SIZE ${size}`];
  for(let bi=0;bi<size;bi++)for(let gi=0;gi<size;gi++)for(let ri=0;ri<size;ri++){
    const [r,g,bl]=[ri,gi,bi].map(i=>linear(i/(size-1)));
    // HLG system gamma 1.2 for a 1000 nit display, then reference white to 1.
    const y=.2627*r+.678*g+.0593*bl,ootf=y>0?y**.2/white:0;
    let rgb=[1.6605*r-.5876*g-.0728*bl,-.1246*r+1.1329*g-.0083*bl,-.0182*r-.1006*g+1.1187*bl].map(v=>Math.max(0,v*ootf));
    const m=Math.max(...rgb);
    if(m>knee){const u=(m-knee)/(peak-knee),t=knee+(1-knee)*k*u/(1+(k-1)*u);rgb=rgb.map(v=>v*t/m);}
    lines.push(rgb.map(v=>Math.min(1,v)**(1/2.4)).map(v=>v.toFixed(6)).join(' '));
  }
  return lines.join('\n')+'\n';
}
function settingsFor(clip,input={}) {
  const s={profile:PROFILES.includes(input.profile)?input.profile:'auto',lutStrength:clamp(input.lutStrength??100,0,100),vivid:!!input.vivid,mute:!!input.mute,gainDb:clamp(input.gainDb,-60,12),exposure:clamp(input.exposure,-3,3)};
  for(const k of ['brilliance','contrast','highlights','shadows','saturation','warmth','tint'])s[k]=clamp(input[k],-100,100);
  s.trimStart=clamp(input.trimStart??0,0,Math.max(0,clip.duration-.05));
  s.trimEnd=clamp(input.trimEnd??clip.duration,s.trimStart+.05,clip.duration,clip.duration);
  return s;
}
function effectiveProfile(clip,s) {return s.profile==='auto'?clip.profile:s.profile;}
function filterGraph(clip,s,lut,{height=1080,before=false,still=false}={}) {
  // All display adjustments operate in full-range RGB with at least 16-bit precision.
  // The DJI files tag BT.709 YUV, even when their RGB signal is logarithmic. HLG is BT.2020.
  const w=clip.width>=clip.height?Math.round(height*16/9/2)*2:height;
  const h=clip.width>=clip.height?height:Math.round(height*16/9/2)*2;
  const filters=[`scale=w='min(iw,${w})':h='min(ih,${h})':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos:in_color_matrix=${effectiveProfile(clip,s)==='HLG'?'bt2020':'bt709'}:out_range=full`, 'format=gbrp16le'];
  if(!before) {
    if(lut)filters.push(`lut3d=file='${lut.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"'\\''")}':interp=tetrahedral`);
    // Packed RGB gives lutrgb the full 65535 range. Planar maxval is 65280.
    // Exposure is a 2^EV gain in display light (gamma 2.4). Above half of white, a brighter
    // clip rolls off toward white instead of clipping. gpu-preview.js runs the same math.
    if(s.exposure){const g=2**s.exposure,t=EXPOSURE_KNEE,a=(g-t)/(1-t),x='ld(0)',u=`(${x}-${t})/(${g-t})`;
      const lift=g>1?`if(gt(${x},${t}),${t}+${1-t}*${a}*${u}/(1+${a-1}*${u}),${x})`:x;
      const expr=`st(0,pow(val/maxval,2.4)*${g});pow(min(${lift},1),${1/2.4})*maxval`;
      filters.push(`format=rgb48le,lutrgb=r='${expr}':g='${expr}':b='${expr}',format=gbrp16le`);}
    // Monotonic RGB curve: gentle brilliance plus distinct shadow/highlight weights.
    if(s.brilliance||s.contrast||s.shadows||s.highlights) {
      let previous=0;
      const points=[0,.125,.25,.5,.75,.875,1].map((x,i)=>{
        let y=x+(s.shadows/100)*.22*Math.sin(Math.PI*x)*(1-x)**2+(s.highlights/100)*.22*Math.sin(Math.PI*x)*x*x;
        y+=(s.brilliance/100)*.16*Math.sin(Math.PI*x)*(1-1.35*x);
        y+=(s.contrast/100)*.2*Math.sin(2*Math.PI*(x-.5));
        y=i===0?0:i===6?1:Math.min(.995,Math.max(previous+.005,y)); previous=y;return `${x}/${y.toFixed(6)}`;
      }).join(' ');
      filters.push(`curves=all='${points}':interp=pchip`);
    }
    if(s.warmth||s.tint) {
      const r=s.warmth*.001+s.tint*.0004,b=-s.warmth*.001+s.tint*.0004,g=-s.tint*.0008;
      filters.push(`colorbalance=rs=${r}:rm=${r}:rh=${r}:gs=${g}:gm=${g}:gh=${g}:bs=${b}:bm=${b}:bh=${b}:pl=1`);
    }
    if(s.saturation) {
      const sat=1+s.saturation/100,k=1-sat,wr=.2126,wg=.7152,wb=.0722;
      filters.push(`colorchannelmixer=rr=${k*wr+sat}:rg=${k*wg}:rb=${k*wb}:gr=${k*wr}:gg=${k*wg+sat}:gb=${k*wb}:br=${k*wr}:bg=${k*wg}:bb=${k*wb+sat}`);
    }
  }
  filters.push(still?'format=rgb24':'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited');
  return filters.join(',');
}
// Clip files under a source, in subfolders too. Hidden entries (including macOS ._ files
// and .Trashes on camera cards) are skipped.
async function listClips(dir,depth=0){
  let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch(error){if(depth)return [];throw error;}
  const files=[];
  for(const e of entries){if(e.name.startsWith('.'))continue;const file=path.join(dir,e.name);
    if(e.isDirectory()&&depth<6)files.push(...await listClips(file,depth+1));
    else if(e.isFile()&&/\.(mp4|mov|m4v)$/i.test(e.name))files.push(file);}
  return files;
}
// Trips are the first folders under the source and chapters are the folders below them.
// Names match Finder, which shows a ":" in a folder name as "/".
function folderOrganization(source,clips){
  const label=name=>name.replace(/:/g,'/');
  const projects=new Map(),assignments={};
  for(const c of clips){
    const parts=path.relative(source,path.dirname(c.path)).split(path.sep).filter(Boolean);if(!parts.length)continue;
    const projectId='f'+hash(parts[0]);
    if(!projects.has(projectId))projects.set(projectId,{id:projectId,name:label(parts[0]),folder:parts[0],chapters:[]});
    const project=projects.get(projectId);let chapterId='';
    for(let i=1;i<parts.length;i++){
      const folder=parts.slice(0,i+1).join('/'),id='f'+hash(folder);
      if(!project.chapters.some(ch=>ch.id===id))project.chapters.push({id,name:parts.slice(1,i+1).map(label).join(' / '),parentId:chapterId,folder});
      chapterId=id;
    }
    assignments[c.id]={projectId,chapterId};
  }
  const byFolder=(a,b)=>a.folder.localeCompare(b.folder,undefined,{numeric:true});
  return {folders:true,projects:[...projects.values()].sort(byFolder).map(({folder,...p})=>({...p,chapters:p.chapters.sort(byFolder).map(({folder,...c})=>c)})),assignments};
}
class MediaEngine {
  constructor({dataDir,lutDir,onScan=()=>{},onExport=()=>{}}) {
    this.dataDir=dataDir;this.cache=path.join(dataDir,'media-cache');this.lutDir=lutDir;this.onScan=onScan;this.onExport=onExport;this.clips=[];this.edits={};this.organization={projects:[],assignments:{},favorites:[]};this.view={};this.exportSettings={};this.exportRecords={};this.exportPresets=[];this.preferences={autoplay:true};this.output=path.join(require('node:os').homedir(),'Movies','Pocket Room Exports');this.source='';this.jobs=null;this.children=new Set();this.pending=new Map();
  }
  async init(){
    await fs.mkdir(this.cache,{recursive:true});
    try {const j=JSON.parse(await fs.readFile(path.join(this.dataDir,'library.json'),'utf8'));Object.assign(this,{clips:j.clips||[],edits:j.edits||{},exportSettings:j.exportSettings||{},exportRecords:j.exportRecords||{},exportPresets:j.exportPresets||[],source:j.source||'',output:j.output||this.output,organization:j.organization||this.organization,view:j.view||{},preferences:{...this.preferences,...j.preferences}});
      // Before 0.4 exposure was a gain on encoded RGB, 2.4 times stronger than its label.
      // Old values become real stops, so saved clips look the same below the roll-off.
      if(j.exposureScale!=='stops')for(const e of Object.values(this.edits))if(e?.exposure)e.exposure=Math.round(e.exposure*2.4*1e6)/1e6;}catch{}
    this.organization=cleanOrganization(this.organization);
    if(!Object.keys(this.view).length)this.view=defaultView();
    await this.refreshLuts();
    // Cache is disposable. A failed prune must never block launch.
    await this.pruneCache(this.cache).catch(error=>console.error('Cache prune failed',error));
    await this.pruneCache(path.join(this.dataDir,'cache'),0).catch(error=>console.error('Legacy cache prune failed',error));
    await this.save();
    return this.snapshot();
  }
  // Retain recent work up to 2 GB and delete only owned generated files. Before 1.4 the
  // cache was userData/cache, which a case-insensitive disk shares with Chromium's Cache.
  async pruneCache(dir,maxAge=7*864e5){
    let names;try{names=await fs.readdir(dir);}catch(error){if(error.code==='ENOENT')return;throw error;}
    const entries=(await Promise.all(names.filter(n=>OWNED_CACHE.test(n)).map(async n=>({n,s:await fs.lstat(path.join(dir,n)).catch(()=>null)})))).filter(e=>e.s?.isFile());
    // Thumbnails are small and slow to make, so only the 2 GB cap or a full clear removes them.
    let bytes=0;for(const e of entries.sort((a,b)=>b.s.mtimeMs-a.s.mtimeMs)){bytes+=e.s.size;const expired=maxAge<=0||(!e.n.endsWith('-thumb.jpg')&&Date.now()-e.s.mtimeMs>maxAge);if(bytes>2e9||expired)await fs.rm(path.join(dir,e.n),{force:true});}
  }
  async refreshLuts(){this.luts={};for(const k of ['dlog2','dlog2Vivid','dlog','dlogm'])this.luts[k]=await fs.access(path.join(this.lutDir,k+'.cube')).then(()=>true,()=>false);return this.luts;}
  // Exported files of these clips that still match their current edits and still exist.
  async shareable(ids=[]){
    const paths=[];let missing=0;
    for(const id of new Set(ids)){const c=this.clips.find(x=>x.id===id),receipt=this.exportRecords[id];if(!c||!receipt)continue;
      if(receipt.signature!==signature(c,settingsFor(c,this.edits[id]),this.exportSettings))continue;
      if(await fs.access(receipt.path).then(()=>true,()=>false))paths.push(receipt.path);else missing++;}
    return {paths,missing};
  }
  async cacheBytes(){let bytes=0;for(const n of await fs.readdir(this.cache).catch(()=>[])){if(!OWNED_CACHE.test(n))continue;const s=await fs.lstat(path.join(this.cache,n)).catch(()=>null);if(s?.isFile())bytes+=s.size;}return bytes;}
  async clearCache(){if(this.jobs?.state==='running')throw new Error('Wait for the export to finish, then clear the cache.');this.tonalCache?.clear();await this.pruneCache(this.cache,-1);return this.cacheBytes();}
  snapshot(){return {exposureScale:'stops',clips:this.clips,edits:this.edits,luts:this.luts,source:this.source,output:this.output,exportSettings:this.exportSettings,exportRecords:this.exportRecords,exportPresets:this.exportPresets,organization:this.organization,view:this.view,preferences:this.preferences};}
  async save(data={}) {
    if(data.edits) {for(const c of this.clips)if(data.edits[c.id])this.edits[c.id]=settingsFor(c,data.edits[c.id]);}
    if(data.exportSettings)this.exportSettings=data.exportSettings;
    if(Array.isArray(data.exportPresets))this.exportPresets=data.exportPresets.filter(p=>p&&typeof p.name==='string'&&p.name.trim()).map(p=>({name:p.name.trim().slice(0,80),...exportOptions(p)}));
    if(data.organization)this.organization=cleanOrganization(data.organization);
    if(data.view&&typeof data.view==='object'&&!Array.isArray(data.view))this.view=JSON.parse(JSON.stringify(data.view));
    if(data.preferences&&typeof data.preferences==='object')this.preferences={autoplay:data.preferences.autoplay!==false};
    const value=JSON.stringify(this.snapshot());
    this.saving=(this.saving||Promise.resolve()).catch(()=>{}).then(async()=>{const temp=path.join(this.dataDir,'library.tmp');await fs.writeFile(temp,value);await fs.rename(temp,path.join(this.dataDir,'library.json'));});
    await this.saving;
  }
  async scan(source) {
    if(this.scanning)throw new Error('A folder is already being scanned.');
    if(this.jobs?.state==='running')throw new Error('Wait for the export to finish before opening another folder.');
    this.scanning=true;
    try {
      source=await fs.realpath(source);const files=(await listClips(source)).sort();
      let cursor=0,done=0;const clips=[],errors=[];
      // A moved clip keeps its old id, so its edits, favorite and export record follow it.
      // An unchanged file reuses its stored metadata instead of running FFprobe again.
      const previous=new Map(this.clips.map(c=>[c.name+'|'+c.size,c])),used=new Set();
      const read=async file=>{const stat=await fs.stat(file),known=previous.get(path.basename(file)+'|'+stat.size);
        if(known?.probe===PROBE_VERSION&&(known.mtimeMs===stat.mtimeMs||(known.mtimeMs===undefined&&hash([known.path,stat.size,stat.mtimeMs])===known.id)))return {...known,path:file,mtimeMs:stat.mtimeMs};
        return probe(file);};
      this.onScan({done,total:files.length});
      await Promise.all(Array.from({length:Math.min(4,files.length)},async()=>{while(cursor<files.length){const file=files[cursor++];try{clips.push(await read(file));}catch(e){errors.push({name:path.basename(file),error:e.message});}this.onScan({done:++done,total:files.length});}}));
      for(const c of clips){const before=previous.get(c.name+'|'+c.size);if(before?.id&&!used.has(before.id)){c.id=before.id;
        // Thumbnails are graded with the detected profile, so a new detection redraws them.
        if(before.profile!==c.profile)await fs.rm(path.join(this.cache,`${c.id}-thumb.jpg`),{force:true});}used.add(c.id);}
      this.clips=clips.sort((a,b)=>a.name.localeCompare(b.name));this.source=source;
      const favorites=this.organization.favorites||[];
      this.organization=this.clips.some(c=>path.dirname(c.path)!==source)?{...folderOrganization(source,this.clips),favorites}:cleanOrganization(this.organization.folders?{favorites}:this.organization);
      const projectId=Object.values(this.organization.assignments).find(a=>a.projectId===this.view.projectId)&&this.clips.some(c=>this.organization.assignments[c.id]?.projectId===this.view.projectId)?this.view.projectId:'';
      this.view={...this.view,projectId,chapterId:'',activeId:null,selected:[],playhead:0};
      await this.save();return {clips:this.clips,source,errors,organization:this.organization,view:this.view};
    }finally{this.scanning=false;}
  }
  clip(id){const c=this.clips.find(c=>c.id===id);if(!c)throw new Error('Clip is no longer in this folder. Open the folder again.');return c;}
  async lut(clip,s,{allowUnknown=false}={}) {
    const p=effectiveProfile(clip,s);
    if(p==='Unknown'&&!allowUnknown)throw new Error('Choose the recorded color profile for this clip before previewing or exporting.');
    // The HLG conversion is always full strength. Half converted HDR has no use.
    if(p==='HLG'){const out=path.join(this.cache,'hlgv1-100-v2.cube');
      if(!await fs.access(out).then(()=>true,()=>false)){const tmp=out+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,hlgCube());await fs.rename(tmp,out);}
      return out;}
    const key={'D-Log2':s.vivid?'dlog2Vivid':'dlog2','D-Log':'dlog','D-Log M':'dlogm'}[p];
    if(!key||s.lutStrength===0)return null;
    const original=path.join(this.lutDir,key+'.cube');
    if(!this.luts[key])throw new Error(`The ${p} conversion LUT is missing.`);
    if(s.lutStrength===100)return original;
    // Bake the identity-to-conversion blend into a cube. This is pixel-identical to
    // blending the uncorrected and corrected RGB signals, without two video branches.
    const out=path.join(this.cache,`${key}-${s.lutStrength}-v2.cube`);
    if(await fs.access(out).then(()=>true,()=>false))return out;
    const rows=(await fs.readFile(original,'utf8')).split(/\r?\n/);let n=0,i=0;const amount=s.lutStrength/100;
    const mixed=rows.map(line=>{if(line.startsWith('LUT_3D_SIZE'))n=Number(line.trim().split(/\s+/)[1]);const v=line.trim().split(/\s+/).map(Number);if(v.length!==3||!v.every(Number.isFinite))return line;
      const identity=[i%n,Math.floor(i/n)%n,Math.floor(i/n/n)].map(x=>x/(n-1));i++;return v.map((x,j)=>(identity[j]*(1-amount)+x*amount).toFixed(8)).join(' ');});
    if(!n||i!==n**3)throw new Error('The LUT has an invalid number of color entries.');
    const tmp=out+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,mixed.join('\n'));await fs.rename(tmp,out);return out;
  }
  async process(args,options={}){const ctrl=new AbortController();this.children.add(ctrl);try{return await run(FFMPEG,['-hide_banner','-loglevel','error','-nostdin','-threads','2','-filter_threads','2',...args],{...options,signal:options.signal?AbortSignal.any([options.signal,ctrl.signal]):ctrl.signal});}finally{this.children.delete(ctrl);}}
  // A thumbnail shows the clip's own grade, so the grid shows what will be sent. An ungraded
  // clip keeps the plain name, and a graded one gets a name from its grade. Making a new
  // graded thumbnail removes the clip's older graded ones.
  async thumbnail(arg) {
    const id=typeof arg==='string'?arg:arg?.id,clip=this.clip(id),s=settingsFor(clip,typeof arg==='string'?this.edits[id]:arg.settings);
    const time=s.trimStart+Math.min((s.trimEnd-s.trimStart)*.2,3);
    const gradeKey=c=>{const p=effectiveProfile(clip,c);return hash([p,c.lutStrength,p==='D-Log2'&&c.vivid,c.exposure,c.brilliance,c.contrast,c.highlights,c.shadows,c.saturation,c.warmth,c.tint,Math.min(clip.duration*.2,3)===time?0:time]);};
    const plain=clip.profile!=='HLG'&&gradeKey(settingsFor(clip))===gradeKey(s),name=plain?`${id}-thumb.jpg`:`${id}-${gradeKey(s).slice(0,12)}-thumb.jpg`,out=path.join(this.cache,name);
    if(!await fs.access(out).then(()=>true,()=>false)){
      if(this.pending.has(out))await this.pending.get(out);else{
        // Hardware decoding of the nearest keyframe is about four times faster and gives the
        // same pixels. Files it cannot handle fall back to a full software decode.
        const work=(async()=>{const lut=await this.lut(clip,s,{allowUnknown:true});
          const args=fast=>[...(fast?['-hwaccel','videotoolbox','-skip_frame','nokey']:[]),'-ss',String(time),'-i',clip.path,'-map','0:v:0','-vf',filterGraph(clip,s,lut,{height:180,still:true}),'-frames:v','1','-q:v','4','-y',out];
          try{await this.process(args(true));if(!(await fs.stat(out)).size)throw new Error('empty thumbnail');}catch{await fs.rm(out,{force:true});await this.process(args(false));}
          // HLG thumbnails from before 0.4 show the unconverted picture.
          if(clip.profile==='HLG')await fs.rm(path.join(this.cache,`${id}-thumb.jpg`),{force:true});
          if(!plain)for(const n of await fs.readdir(this.cache).catch(()=>[]))if(n!==name&&n.startsWith(id+'-')&&/^[0-9a-f]{24}-[0-9a-f]{12}-thumb\.jpg$/.test(n))await fs.rm(path.join(this.cache,n),{force:true});})();
        this.pending.set(out,work);try{await work;}finally{this.pending.delete(out);}
      }
    }
    return 'data:image/jpeg;base64,'+(await fs.readFile(out)).toString('base64');
  }
  async cameraLut({id,settings}) {
    const c=this.clip(id),s=settingsFor(c,settings);s.lutStrength=100;
    const lut=await this.lut(c,s);return lut?fs.readFile(lut,'utf8'):null;
  }
  async sourceVideo(id){return {url:pathToFileURL(this.clip(id).path).href};}
  async tonalLut({settings}) {
    const s=settingsFor({duration:1},settings);
    s.exposure=0;s.lutStrength=0;s.warmth=0;s.tint=0;s.saturation=0;
    const key=hash([s.brilliance,s.contrast,s.shadows,s.highlights]);
    this.tonalCache ||= new Map();if(this.tonalCache.has(key))return this.tonalCache.get(key);
    this.tonalAbort?.abort();this.tonalAbort=new AbortController();const signal=this.tonalAbort.signal;
    const file=path.join(this.cache,'curve-ramp16.rgb');
    if(!await fs.access(file).then(()=>true,()=>false)){
      const b=Buffer.alloc(65536*6);for(let i=0;i<65536;i++)for(let j=0;j<3;j++)b.writeUInt16LE(i,(i*3+j)*2);await fs.writeFile(file,b);
    }
    // Compile the export's PCHIP curves at every 16-bit input code, no interpolation approximation.
    const filters=filterGraph({width:1,height:1},s,null,{still:true}).replace(/^scale=.*?,format=gbrp16le,/, 'format=gbrp16le,').replace(/format=rgb24$/, 'format=rgb48le');
    const raw=await this.process(['-f','rawvideo','-pixel_format','rgb48le','-video_size','256x256','-i',file,'-vf',filters,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb48le','pipe:1'],{signal});
    const curve=Buffer.alloc(65536*2);for(let i=0;i<65536;i++)curve.writeUInt16LE(raw.readUInt16LE(i*6),i*2);
    const result={data:curve.toString('base64')};this.tonalCache.set(key,result);if(this.tonalCache.size>32)this.tonalCache.delete(this.tonalCache.keys().next().value);return result;
  }
  async frame({id,time,settings,before=false}) {
    this.frameAbort?.abort();this.frameAbort=new AbortController();const signal=this.frameAbort.signal;
    const clip=this.clip(id),s=settingsFor(clip,settings),lut=before?null:await this.lut(clip,s);
    const b=await this.process(['-ss',String(clamp(time,0,Math.max(0,clip.duration-.05))),'-i',clip.path,'-map','0:v:0','-vf',filterGraph(clip,s,lut,{height:720,still:true,before}),'-frames:v','1','-f','image2pipe','-c:v','png','pipe:1'],{signal});
    return 'data:image/png;base64,'+b.toString('base64');
  }
  async encode(c,s,lut,out,options,signal,onProgress) {
    const height=[720,1080,2160].includes(Number(options.resolution))?Number(options.resolution):1080;
    const duration=s.trimEnd-s.trimStart;
    const audio=s.mute?['-an']:['-map','0:a:0?','-af',`volume=${s.gainDb}dB`,'-c:a','aac','-b:a','128k'];
    const args=['-ss',String(s.trimStart),'-i',c.path,'-t',String(duration),'-map','0:v:0',...audio,'-vf',filterGraph(c,s,lut,{height}),'-c:v','h264_videotoolbox','-tag:v','avc1','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv'];
    const defaultRate=Math.round((height===720?3:height===1080?6:20)*(['high','best'].includes(options.quality)?1.6:['small','smaller'].includes(options.quality)?.6:1)*1e6);
    const max=Number(options.maxMB)||0;
    const rate=max?Math.min(defaultRate,Math.floor(max*1e6*.88*8/duration-(s.mute?0:128000))):defaultRate;
    if(rate<100000)throw new Error('This size limit is too small. Increase it or shorten the clip.');
    args.push('-b:v',String(rate),'-map_metadata','-1','-map_chapters','-1','-movflags','+faststart','-progress','pipe:1','-nostats','-y',out);
    await this.process(args,{signal,onProgress});
    if(max&&(await fs.stat(out)).size>max*1e6)throw new Error('The export exceeded the size limit. Increase the limit or shorten the clip.');
  }
  async export({ids,edits,options,output}) {
    if(this.preparingExport||this.jobs?.state==='running')throw new Error('An export is already running.');
    this.preparingExport=true;
    try {
    if(!Array.isArray(ids)||!ids.length)throw new Error('Select at least one clip.');
    const selected=[...new Set(ids)].map(id=>({c:this.clip(id),s:settingsFor(this.clip(id),edits?.[id]||this.edits[id])}));
    for(const x of selected)x.lut=await this.lut(x.c,x.s);
    let proposed=path.resolve(output||this.output),ancestor=proposed;const tail=[];
    while(!await fs.access(ancestor).then(()=>true,()=>false)){tail.unshift(path.basename(ancestor));const parent=path.dirname(ancestor);if(parent===ancestor)throw new Error('Cannot resolve the export folder.');ancestor=parent;}
    const target=path.join(await fs.realpath(ancestor),...tail);
    if(target===this.source||target.startsWith(this.source+path.sep))throw new Error('Choose an export folder outside the source folder.');
    await fs.mkdir(target,{recursive:true});
    this.output=target;await this.save({edits});
    this.exportAbort=new AbortController();this.jobs={state:'running',progress:0,items:selected.map(x=>({id:x.c.id,name:x.c.name,status:'queued',progress:0}))};
    this.onExport(this.jobs);
    this.exportPromise=this.exportLoop(selected,{...options},target);return {started:true};
    } finally {this.preparingExport=false;}
  }
  async exportLoop(selected,options,target) {
    for(let i=0;i<selected.length;i++){
      const {c,s,lut}=selected[i],item=this.jobs.items[i];
      if(this.exportAbort.signal.aborted){item.status='cancelled';continue;}
      item.status='encoding';this.onExport(this.jobs);
      let name=path.parse(c.name).name+'_share',dest=path.join(target,name+'.mp4'),n=2;
      while(await fs.access(dest).then(()=>true,()=>false))dest=path.join(target,`${name}_${n++}.mp4`);
      const temp=path.join(target,`.pocket-${crypto.randomUUID()}.mp4`);
      try{
        let buf='';await this.encode(c,s,lut,temp,options,this.exportAbort.signal,text=>{buf+=text;const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(line.startsWith('out_time_us=')){item.progress=Math.min(.99,Number(line.split('=')[1])/1e6/(s.trimEnd-s.trimStart));this.jobs.progress=(i+item.progress)/selected.length;this.onExport(this.jobs);}}});
        if(this.exportAbort.signal.aborted)throw new Error('Cancelled');
        // Hard-link publication is atomic and cannot overwrite an existing file.
        for(;;){try{await fs.link(temp,dest);break;}catch(e){if(e.code!=='EEXIST')throw e;dest=path.join(target,`${name}_${n++}.mp4`);}}
        item.status='done';item.progress=1;item.path=dest;
        item.receipt={signature:signature(c,s,options),path:dest,exportedAt:new Date().toISOString()};
        this.exportRecords[c.id]=item.receipt;await this.save();
      }catch(e){item.status=this.exportAbort.signal.aborted?'cancelled':'failed';item.error=e.message.slice(-800);}
      finally{await fs.rm(temp,{force:true});}
      this.jobs.progress=(i+1)/selected.length;this.onExport(this.jobs);
    }
    this.jobs.state=this.exportAbort.signal.aborted?'cancelled':this.jobs.items.some(i=>i.status==='failed')?'completed-with-errors':'complete';this.onExport(this.jobs);
  }
  cancelExport(){this.exportAbort?.abort();}
  close(){this.tonalAbort?.abort();this.frameAbort?.abort();this.cancelExport();for(const c of this.children)c.abort();}
}
module.exports={MediaEngine,listClips,folderOrganization,protobufVarints,pocket3Mode,probe,identify,settingsFor,effectiveProfile,filterGraph,hlgCube,run};
