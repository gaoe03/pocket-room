const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
// DJI's LUTs cannot be shared, so unit tests use small generated ones. They copy DJI's
// formatting quirks: a title line, tabs, CRLF line ends and scientific notation.
async function testLuts(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pocket-luts-'));
  const curves={dlog2:.8,dlog2Vivid:.7,dlog:.9,dlogm:.85};
  for(const [name,gamma] of Object.entries(curves)){
    const n=17,rows=[`TITLE "Generated ${name}"`,`LUT_3D_SIZE ${n}`];
    for(let b=0;b<n;b++)for(let g=0;g<n;g++)for(let r=0;r<n;r++)rows.push([r,g,b].map(x=>{const v=(x/(n-1))**gamma;return v&&v<.2?v.toExponential(6):v.toFixed(6);}).join('\t'));
    await fs.writeFile(path.join(dir,name+'.cube'),rows.join('\r\n')+'\r\n');
  }
  return dir;
}
module.exports={testLuts};
