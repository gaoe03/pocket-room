const {app,BrowserWindow,ipcMain,dialog,shell,Menu} = require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const {MediaEngine}=require('./media.cjs');
let win,engine,quitting=false;
// Test runs use their own data and stay hidden: no window, no Dock icon, no focus change.
const testing=Boolean(process.env.POCKET_TEST_DATA);
if(testing)app.setPath('userData',process.env.POCKET_TEST_DATA);
const send=(channel,data)=>{if(win&&!win.isDestroyed())win.webContents.send(channel,data);};
const handlers={
  init:()=>engine.snapshot(),
  chooseSource:async()=>{const result=await dialog.showOpenDialog(win,{title:'Open a folder of clips',properties:['openDirectory'],defaultPath:engine.source||'/Volumes'});return result.canceled?null:{source:result.filePaths[0]};},
  // The first mounted card with a DCIM folder, preferring one that holds DJI footage.
  defaultSource:async()=>{
    const cards=[];
    for(const volume of await fs.readdir('/Volumes').catch(()=>[])){const dcim=path.join('/Volumes',volume,'DCIM');const names=await fs.readdir(dcim).catch(()=>null);if(names)cards.push({source:dcim,dji:names.some(n=>/^DJI_/i.test(n))});}
    const card=cards.find(c=>c.dji)||cards[0];if(!card)throw new Error('Camera card not found. Connect it, or choose a folder.');return {source:card.source};
  },
  scan:async source=>{if(typeof source!=='string'||!path.isAbsolute(source))throw new Error('Choose a folder first.');return engine.scan(source);},
  chooseOutput:async()=>{const result=await dialog.showOpenDialog(win,{title:'Save exported clips to',properties:['openDirectory','createDirectory'],defaultPath:engine.output});if(result.canceled)return null;engine.output=result.filePaths[0];await engine.save();return {output:engine.output};},
  save:data=>engine.save(data),
  thumbnail:id=>engine.thumbnail(id),
  frame:data=>engine.frame(data),
  cameraLut:data=>engine.cameraLut(data),
  tonalLut:data=>engine.tonalLut(data),
  sourceVideo:id=>engine.sourceVideo(id),
  export:data=>engine.export(data),
  cancelExport:()=>engine.cancelExport(),
  reveal:async()=>{await fs.mkdir(engine.output,{recursive:true});const error=await shell.openPath(engine.output);if(error)throw new Error(error);},
};
async function createWindow(){
  win=new BrowserWindow({width:1500,height:960,minWidth:1050,minHeight:720,title:'Pocket Room',backgroundColor:'#e9e9ed',show:!testing,webPreferences:{backgroundThrottling:!testing,preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!==win.webContents.getURL())event.preventDefault();});
  win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  await win.loadFile(path.join(__dirname,'index.html'));
  let checkingClose=false,closeAllowed=false;
  win.on('close',async event=>{
    if(closeAllowed)return;
    event.preventDefault();
    if(checkingClose)return;
    checkingClose=true;
    try {
      if(engine.jobs?.state==='running'){
        const {response}=await dialog.showMessageBox(win,{type:'question',message:'An export is still running',detail:'Keep the app open to finish, or stop and quit. Completed clips will be kept.',buttons:['Keep exporting','Stop and quit'],defaultId:0,cancelId:0});
        if(response!==1)return;
        engine.close();
        await Promise.race([engine.exportPromise,new Promise(r=>setTimeout(r,5000))]);
      }
      await win.webContents.executeJavaScript('window.pocketFlush ? window.pocketFlush() : Promise.resolve()');
      await engine.saving;
      closeAllowed=true;quitting=true;win.close();
    }catch(error){
      await dialog.showMessageBox(win,{type:'error',message:'Changes could not be saved',detail:error.message,buttons:['Keep app open']});
    }finally{checkingClose=false;}
  });
}
app.whenReady().then(async()=>{
  if(testing){app.setActivationPolicy('accessory');app.dock?.hide();}
  if(!app.isPackaged)app.dock?.setIcon(path.join(__dirname,'../assets/icon/icon.png'));
  const lutDir=path.join(app.getPath('userData'),'luts');
  await fs.mkdir(lutDir,{recursive:true});
  // LUTs are not part of the source. Copy any bundled ones, and keep ones already added to app data.
  for(const key of ['dlog2','dlog2Vivid','dlog','dlogm'])await fs.copyFile(path.join(__dirname,'../assets/luts',key+'.cube'),path.join(lutDir,key+'.cube')).catch(()=>{});
  engine=new MediaEngine({dataDir:app.getPath('userData'),lutDir,onScan:data=>send('scan-progress',data),onExport:data=>send('export-progress',data)});
  await engine.init();
  for(const [name,fn] of Object.entries(handlers))ipcMain.handle('pocket:'+name,async(event,arg)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('Unsupported window');return fn(arg);});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Pocket Room',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},{label:'File',submenu:[{label:'Save settings',accelerator:'CmdOrCtrl+S',click:()=>send('edit-command','save')}]},{label:'Edit',submenu:[{label:'Undo',accelerator:'CmdOrCtrl+Z',click:()=>send('edit-command','undo')},{label:'Redo',accelerator:'CmdOrCtrl+Shift+Z',click:()=>send('edit-command','redo')},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'},{type:'separator'},{label:'Copy color adjustments',accelerator:'CmdOrCtrl+Shift+C',click:()=>send('edit-command','copy')},{label:'Paste color adjustments',accelerator:'CmdOrCtrl+Shift+V',click:()=>send('edit-command','paste')}]},{label:'View',submenu:[{label:'Streaming mode',accelerator:'CmdOrCtrl+Shift+F',click:()=>send('edit-command','stream')},{type:'separator'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},{label:'Window',submenu:[{role:'minimize'},{role:'zoom'}]}]));
  await createWindow();
}).catch(error=>{dialog.showErrorBox('Pocket Room could not open',error.message);app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{if(quitting||engine?.jobs?.state!=='running')engine?.close();});
