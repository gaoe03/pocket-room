const {app,BrowserWindow,ipcMain,dialog,shell,Menu,ShareMenu,nativeImage,Notification} = require('electron');
const {existsSync,readdirSync}=require('node:fs');
const path=require('node:path');
const fs=require('node:fs/promises');
const {MediaEngine}=require('./media.cjs');
let win,engine,lutDir,quitting=false;
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
  // Autoplay steps, so a failure on the user's Mac can be read afterwards. Capped at 256 KB.
  log:async line=>{const file=path.join(app.getPath('userData'),'autoplay.log');const size=await fs.stat(file).then(s=>s.size,()=>0);if(size>256e3)await fs.rename(file,file+'.old').catch(()=>{});await fs.appendFile(file,`${new Date().toISOString()} ${String(line).slice(0,300)}\n`);},
  settingsInfo:async()=>({version:app.getVersion(),luts:await engine.refreshLuts(),cacheBytes:await engine.cacheBytes()}),
  clearCache:()=>engine.clearCache(),
  openLuts:async()=>{const error=await shell.openPath(lutDir);if(error)throw new Error(error);},
  // Opens the macOS share menu at the button. Test runs return the files instead, so no
  // native menu appears on screen.
  share:async({ids,x,y}={})=>{
    const {paths,missing}=await engine.shareable(Array.isArray(ids)?ids:[]);
    if(!paths.length)throw new Error(missing?'The exported files were moved or deleted. Export the clips again.':'Export the selected clips first.');
    if(!testing)new ShareMenu({filePaths:paths}).popup({window:win,x:Math.round(Number(x))||0,y:Math.round(Number(y))||0});
    return {count:paths.length,missing,...(testing?{paths}:{})};
  },
  // The clip card's right-click menu, built from the renderer's items. A chosen item comes back
  // as a clip-action event, like the app menu's commands. Test runs show no native menu.
  clipMenu:({id,items}={})=>{
    const template=(Array.isArray(items)?items.slice(0,20):[]).map(i=>i?.type==='separator'?{type:'separator'}:{label:String(i?.label||'').slice(0,80),enabled:i?.enabled!==false,...(i?.accelerator?{accelerator:String(i.accelerator),registerAccelerator:false}:{}),click:()=>send('clip-action',{id,choice:String(i?.id||'')})});
    if(!template.length)return;const menu=Menu.buildFromTemplate(template);
    if(testing)global.pocketClipMenu=menu;else menu.popup({window:win});
  },
  // Shows a clip's original, or its export, selected in Finder. Test runs return the path.
  showInFinder:async({id,exported}={})=>{
    const clip=engine.clip(id),file=exported?engine.exportRecords[id]?.path:clip.path;
    if(!file||!await fs.access(file).then(()=>true,()=>false))throw new Error(exported?'The exported file was moved or deleted. Export the clip again.':'The original file is not available. Connect the camera card.');
    if(!testing)shell.showItemInFolder(file);
    return testing?{path:file}:{};
  },
  reveal:async()=>{await fs.mkdir(engine.output,{recursive:true});const error=await shell.openPath(engine.output);if(error)throw new Error(error);},
};
// A long export is when you leave the app, so its progress shows on the Dock icon. When it
// ends while you are in another app, a notification says so. Test runs only record both.
let lastExportState='';
function exportFeedback(jobs){
  if(testing){(global.pocketExportFeedback||=[]).push({state:jobs.state,progress:jobs.progress,focused:win?.isFocused()});}
  else if(win&&!win.isDestroyed())win.setProgressBar(jobs.state==='running'?Math.max(0,Math.min(1,jobs.progress||0)):-1);
  const finished=jobs.state!=='running'&&lastExportState==='running';lastExportState=jobs.state;
  if(!finished||jobs.state==='cancelled'||win?.isFocused())return;
  const done=jobs.items.filter(i=>i.status==='done').length,failed=jobs.items.filter(i=>i.status==='failed').length;
  const note={title:failed?'Export finished with errors':'Export complete',body:`${done} clip${done===1?'':'s'} exported${failed?`, ${failed} failed`:''}.`};
  if(testing){global.pocketExportFeedback.push({notify:note});return;}
  if(!Notification.isSupported())return;
  const n=new Notification({...note,silent:false});n.on('click',()=>{if(win&&!win.isDestroyed()){win.show();win.focus();}});n.show();
}
async function createWindow(){
  win=new BrowserWindow({width:1500,height:960,minWidth:1050,minHeight:720,title:'Pocket Room',backgroundColor:'#1b1b1d',titleBarStyle:'hiddenInset',trafficLightPosition:{x:14,y:15},show:!testing,webPreferences:{backgroundThrottling:!testing,preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
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
  lutDir=path.join(app.getPath('userData'),'luts');
  await fs.mkdir(lutDir,{recursive:true});
  // LUTs are not part of the source. Copy any bundled ones, and keep ones already added to app data.
  for(const key of ['dlog2','dlog2Vivid','dlog','dlogm'])await fs.copyFile(path.join(__dirname,'../assets/luts',key+'.cube'),path.join(lutDir,key+'.cube')).catch(()=>{});
  engine=new MediaEngine({dataDir:app.getPath('userData'),lutDir,onScan:data=>send('scan-progress',data),onExport:data=>{send('export-progress',data);exportFeedback(data);}});
  await engine.init();
  // Dragging a card carries its current export out to Finder, Messages or an editor. Only
  // exports are ever dragged, never the camera originals. The drag has to start while the
  // mouse is still down, so this is a plain message with synchronous checks.
  ipcMain.on('pocket:startDrag',(event,ids)=>{
    if(event.sender!==win?.webContents||!Array.isArray(ids))return;
    // The window has the live edits, so it picks which exports are current. Paths still come
    // only from export records.
    const files=[...new Set(ids.slice(0,500).map(id=>engine.exportRecords[id]?.path).filter(file=>file&&existsSync(file)))];if(!files.length)return;
    // A graded clip's thumbnail has a grade in its name. Prefer it, so the drag shows the look.
    const names=readdirSync(engine.cache).filter(n=>n.startsWith(ids[0]+'-')&&n.endsWith('-thumb.jpg'));
    const thumb=path.join(engine.cache,names.find(n=>n!==`${ids[0]}-thumb.jpg`)||`${ids[0]}-thumb.jpg`);let icon=existsSync(thumb)?nativeImage.createFromPath(thumb):nativeImage.createEmpty();
    icon=icon.isEmpty()?nativeImage.createFromPath(path.join(__dirname,'brand.png')):icon.resize({width:96});
    if(testing)global.pocketLastDrag={files};else event.sender.startDrag({file:files[0],files,icon});
  });
  for(const [name,fn] of Object.entries(handlers))ipcMain.handle('pocket:'+name,async(event,arg)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('Unsupported window');return fn(arg);});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Pocket Room',submenu:[{role:'about'},{type:'separator'},{label:'Settings…',accelerator:'CmdOrCtrl+,',click:()=>send('edit-command','settings')},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},{label:'File',submenu:[{label:'Open Folder…',accelerator:'CmdOrCtrl+O',click:()=>send('edit-command','open')},{label:'Rescan',accelerator:'CmdOrCtrl+R',click:()=>send('edit-command','rescan')},{type:'separator'},{label:'Save settings',accelerator:'CmdOrCtrl+S',click:()=>send('edit-command','save')}]},{label:'Edit',submenu:[{label:'Undo',accelerator:'CmdOrCtrl+Z',click:()=>send('edit-command','undo')},{label:'Redo',accelerator:'CmdOrCtrl+Shift+Z',click:()=>send('edit-command','redo')},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'},{type:'separator'},{label:'Copy color adjustments',accelerator:'CmdOrCtrl+Shift+C',click:()=>send('edit-command','copy')},{label:'Paste color adjustments',accelerator:'CmdOrCtrl+Shift+V',click:()=>send('edit-command','paste')}]},{label:'View',submenu:[{label:'Grid',accelerator:'CmdOrCtrl+1',click:()=>send('edit-command','grid')},{label:'Viewer',accelerator:'CmdOrCtrl+2',click:()=>send('edit-command','viewer')},{label:'Show Sidebar',accelerator:'CmdOrCtrl+Alt+S',click:()=>send('edit-command','sidebar')},{type:'separator'},{label:'Streaming mode',accelerator:'CmdOrCtrl+Shift+F',click:()=>send('edit-command','stream')},{type:'separator'},{label:'Larger thumbnails',accelerator:'CmdOrCtrl+=',click:()=>send('edit-command','thumbs-larger')},{label:'Larger thumbnails',accelerator:'CmdOrCtrl+Plus',visible:false,click:()=>send('edit-command','thumbs-larger')},{label:'Smaller thumbnails',accelerator:'CmdOrCtrl+-',click:()=>send('edit-command','thumbs-smaller')},{label:'Default thumbnail size',accelerator:'CmdOrCtrl+0',click:()=>send('edit-command','thumbs-default')},{type:'separator'},{role:'togglefullscreen'}]},{label:'Window',submenu:[{role:'minimize'},{role:'zoom'}]}]));
  await createWindow();
}).catch(error=>{dialog.showErrorBox('Pocket Room could not open',error.message);app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{if(quitting||engine?.jobs?.state!=='running')engine?.close();});
