const {test}=require('node:test');const assert=require('node:assert/strict');
const {protobufVarints,pocket3Mode,identify}=require('../src/media.cjs');
const varint=n=>{const out=[];do{let b=n%128;n=Math.floor(n/128);if(n)b|=128;out.push(b);}while(n);return out;};
const field=(n,value)=>Array.isArray(value)?[...varint(n*8+2),...varint(value.length),...value]:[...varint(n*8),...varint(value)];
// Shaped like the first "DJI meta" packet of a Pocket 3 clip: 2.3.5 and optional 2.4.1.
const packet=(gamma,mode)=>Buffer.from([...field(1,[...field(1,7)]),...field(2,[...field(3,[...field(4,1),...field(5,gamma),...field(6,4)]),...(mode===undefined?[]:field(4,[...field(1,mode)]))]),...field(9,[0xde,0xad])]);
test('Pocket 3 color modes come from the DJI meta protobuf',()=>{
 assert.equal(protobufVarints(packet(10,19)).get('2.4.1'),19);
 assert.equal(pocket3Mode(protobufVarints(packet(10,19))),'D-Log M');
 assert.equal(pocket3Mode(protobufVarints(packet(10,9))),'HLG');
 assert.equal(pocket3Mode(protobufVarints(packet(8))),'Normal');
 // Unfamiliar values stay Unknown, so the user still chooses.
 assert.equal(pocket3Mode(protobufVarints(packet(10))),'Unknown');
 assert.equal(pocket3Mode(protobufVarints(packet(8,42))),'Unknown');
 assert.equal(pocket3Mode(new Map()),'Unknown');
 assert.throws(()=>protobufVarints(Buffer.from([0x12,0x09,0x01])),RangeError);
 // Pocket 3 still has no container tag, so identify alone leaves it Unknown.
 assert.equal(identify({encoder:'DJI OsmoPocket3'},{color_transfer:'bt709'}),'Unknown');
});
