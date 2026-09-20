const {test}=require('node:test');const assert=require('node:assert/strict');
const {History,DEFAULTS,COLOR_KEYS,color,signature,rangeIds}=require('../src/adjustments.js');
test('one slider drag and a bulk patch each undo atomically without replacing other values',()=>{
 const edits={a:{...DEFAULTS,profile:'D-Log M',trimEnd:3,mute:true,saturation:10},b:{...DEFAULTS,profile:'auto',trimEnd:5,saturation:20}};
 const original=structuredClone(edits),h=new History();h.begin('Exposure',['a','b'],edits);
 for(const v of [.1,.2,.3])for(const id of ['a','b'])edits[id].exposure=v;
 h.commit(edits);assert.equal(h.undoStack.length,1);assert.equal(edits.b.saturation,20);
 h.move('undo',edits);assert.deepEqual(edits,original);h.move('redo',edits);assert.equal(edits.a.exposure,.3);
 h.begin('Paste',['b'],edits);Object.assign(edits.b,color(edits.a));h.commit(edits);
 assert.equal(edits.b.profile,'auto');assert.equal(edits.b.trimEnd,5);assert.equal(edits.b.mute,false);
 h.move('undo',edits);assert.equal(edits.b.saturation,20);h.move('redo',edits);assert.equal(edits.b.saturation,10);
 h.move('undo',edits);h.begin('No-op',['a'],edits);h.commit(edits);assert.equal(h.redoStack.length,1);
 h.begin('New change',['a'],edits);edits.a.contrast=10;h.commit(edits);assert.equal(h.redoStack.length,0);
 assert.equal(COLOR_KEYS.includes('profile'),false);
});
test('shift ranges use current filtered order and never pull in hidden intermediate clips',()=>{
 const clips=['d','b','a'].map(id=>({id}));assert.deepEqual(rangeIds(clips,'d','a'),['d','b','a']);assert.deepEqual(rangeIds(clips,'a','d'),['d','b','a']);assert.deepEqual(rangeIds(clips,'hidden','b'),['b']);
});
test('export signatures account for edits and output options, not presentation or trip labels',()=>{
 const c={id:'a',duration:5,profile:'D-Log2'},edit={...DEFAULTS,trimEnd:5};const first=signature(c,edit,{});
 assert.equal(first,signature({...c,name:'renamed label'},edit,{resolution:'1080',quality:'balanced',maxMB:''}));
 for(const change of [{exposure:1},{trimEnd:3},{mute:true},{gainDb:-6},{profile:'Normal'},{vivid:true},{lutStrength:40}])assert.notEqual(first,signature(c,{...edit,...change},{}));
 for(const change of [{resolution:720},{quality:'smaller'},{maxMB:5}])assert.notEqual(first,signature(c,edit,change));
});

test('exposure correction invalidates only nonzero exposure receipts',()=>{
 const clip={id:'a',duration:5,profile:'Normal'};
 const zero=JSON.parse(signature(clip,{exposure:0},{}));
 assert.equal('exposurePipeline' in zero,false);
 const nonzero=JSON.parse(signature(clip,{exposure:.2},{}));
 assert.equal(nonzero.exposurePipeline,'rgb16-gain-v1');
 const legacy={...nonzero};delete legacy.exposurePipeline;
 assert.notEqual(JSON.stringify(legacy),signature(clip,{exposure:.2},{}));
});
