// Renders an HTML or SVG file to PNG. Usage: electron render.cjs <in> <out.png> <width> <height>
const {app,BrowserWindow}=require('electron');const fs=require('node:fs');const path=require('node:path');
const [input,output,w,h]=process.argv.slice(-4);
app.whenReady().then(async()=>{const win=new BrowserWindow({width:+w,height:+h,show:false,useContentSize:true,transparent:true,frame:false,webPreferences:{offscreen:true}});
 win.webContents.setZoomFactor(1);const [file,hash]=input.split("#");await win.loadFile(path.resolve(file),hash?{hash}:{});await new Promise(r=>setTimeout(r,600));
 const image=await win.webContents.capturePage({x:0,y:0,width:+w,height:+h});fs.writeFileSync(output,image.toPNG());app.quit();});
