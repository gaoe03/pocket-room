(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PocketAdjustments=api;})(globalThis,function(){
  const DEFAULTS={profile:'auto',lutStrength:100,vivid:false,exposure:0,brilliance:0,contrast:0,highlights:0,shadows:0,saturation:0,warmth:0,tint:0,trimStart:0,trimEnd:0,mute:false,gainDb:0};
  const COLOR_KEYS=['lutStrength','exposure','brilliance','contrast','highlights','shadows','saturation','warmth','tint'];
  const color=edit=>Object.fromEntries(COLOR_KEYS.map(k=>[k,edit[k]??DEFAULTS[k]]));
  function exportOptions(options={}){return {resolution:Number(options.resolution)||1080,quality:options.quality||'balanced',maxMB:Number(options.maxMB)||0};}
  function signature(clip,edit={},options={}){
    const s={...DEFAULTS,trimEnd:clip.duration,...edit};
    return JSON.stringify({pipeline:1,...(s.exposure?{exposurePipeline:'display-stops-knee-v2'}:{}),id:clip.id,profile:s.profile==='auto'?clip.profile:s.profile,...color(s),vivid:s.vivid,trimStart:s.trimStart,trimEnd:s.trimEnd,mute:s.mute,...(s.gainDb?{gainDb:s.gainDb}:{}),...exportOptions(options)});
  }
  function edited(clip,edit={}){return Object.keys(DEFAULTS).some(k=>(edit[k]??(k==='trimEnd'?clip.duration:DEFAULTS[k]))!==(k==='trimEnd'?clip.duration:DEFAULTS[k]));}
  function rangeIds(clips,anchor,id){const a=clips.findIndex(c=>c.id===anchor),b=clips.findIndex(c=>c.id===id);return a<0||b<0?[id]:clips.slice(Math.min(a,b),Math.max(a,b)+1).map(c=>c.id);}
  class History {
    constructor(){this.undoStack=[];this.redoStack=[];this.pending=null;}
    begin(label,ids,edits){this.commit(edits);this.pending={label,before:Object.fromEntries(ids.map(id=>[id,structuredClone(edits[id])]))};}
    commit(edits){if(!this.pending)return;const p=this.pending;this.pending=null;p.after=Object.fromEntries(Object.keys(p.before).map(id=>[id,structuredClone(edits[id])]));if(JSON.stringify(p.before)===JSON.stringify(p.after))return;this.undoStack.push(p);if(this.undoStack.length>100)this.undoStack.shift();this.redoStack=[];}
    move(direction,edits){this.commit(edits);const from=direction==='undo'?this.undoStack:this.redoStack,to=direction==='undo'?this.redoStack:this.undoStack;const item=from.pop();if(!item)return;for(const [id,value] of Object.entries(direction==='undo'?item.before:item.after))edits[id]=structuredClone(value);to.push(item);return item.label;}
  }
  return {DEFAULTS,COLOR_KEYS,color,signature,exportOptions,edited,rangeIds,History};
});
