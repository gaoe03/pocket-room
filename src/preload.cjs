const {contextBridge,ipcRenderer}=require('electron');
const api={};
for(const name of ['init','chooseSource','defaultSource','scan','chooseOutput','save','thumbnail','frame','cameraLut','tonalLut','sourceVideo','export','cancelExport','reveal','settingsInfo','clearCache','openLuts','share','log','clipMenu','showInFinder'])api[name]=arg=>ipcRenderer.invoke('pocket:'+name,arg);
for(const [name,channel] of [['onCommand','edit-command'],['onScan','scan-progress'],['onExport','export-progress'],['onClipAction','clip-action']])api[name]=callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on(channel,listener);return()=>ipcRenderer.removeListener(channel,listener);};
api.startDrag=ids=>ipcRenderer.send('pocket:startDrag',ids);
contextBridge.exposeInMainWorld('pocket',api);
