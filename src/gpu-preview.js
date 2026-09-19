import * as THREE from 'three';
import {LUTCubeLoader} from '../node_modules/three/examples/jsm/loaders/LUTCubeLoader.js';
import {colorBalanceGLSL} from './vendor/colorbalance.js';
import {tetrahedral} from './vendor/tetrahedral.js';

// Native HTMLMediaElement decoding, Three video textures and postprocessing's
// tetrahedral interpolation. No browser or Three transfer conversion is implicit.
export class GPUPreview {
  constructor(video,canvas,api,onTime){
    this.video=video;this.canvas=canvas;this.api=api;this.onTime=onTime;
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:false,antialias:false,preserveDrawingBuffer:true});
    this.renderer.outputColorSpace=THREE.LinearSRGBColorSpace;this.renderer.toneMapping=THREE.NoToneMapping;
    this.renderer.setPixelRatio(1);this.videoTexture=new THREE.VideoTexture(video);this.videoTexture.colorSpace=THREE.NoColorSpace;
    this.loader=new LUTCubeLoader().setType(THREE.FloatType);this.lutCache=new Map();
    const identity=new Float32Array(2**3*4);for(let i=0;i<8;i++){identity.set([i%2,Math.floor(i/2)%2,Math.floor(i/4),1],i*4);}
    this.identity=this.texture(identity,2);const ramp=new Float32Array(65536);for(let i=0;i<65536;i++)ramp[i]=i/65535;this.tone=this.curveTexture(ramp);
    this.uniforms={source:{value:this.videoTexture},camera:{value:this.identity},tone:{value:this.tone},cameraSize:{value:2},balance:{value:new THREE.Vector3()},saturation:{value:1},curveEnabled:{value:false},strength:{value:0},exposure:{value:1},before:{value:true}};
    this.material=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,uniforms:this.uniforms,vertexShader:'precision highp float; in vec3 position; in vec2 uv; out vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:`precision highp float; precision highp sampler3D; in vec2 vUv; out vec4 result; uniform sampler2D source; uniform sampler3D camera; uniform sampler2D tone;uniform vec3 balance;uniform float saturation;uniform bool curveEnabled; uniform float cameraSize;  uniform float strength; uniform float exposure; uniform bool before;
${tetrahedral}
${colorBalanceGLSL}
vec3 q16(vec3 c){return floor(clamp(c,0.0,1.0)*65535.0+0.5)/65535.0;}
float curve(float x){int i=int(clamp(x,0.0,1.0)*65535.0+0.5);return texelFetch(tone,ivec2(i%256,i/256),0).r;}
void main(){vec3 c=texture(source,vUv).rgb;if(!before){c=clamp(mix(c,tetra(camera,clamp(c,0.0,1.0)*(cameraSize-1.0),1.0/cameraSize).rgb,strength),0.0,1.0);if(strength>0.0)c=floor(c*65535.0)/65535.0;c=floor(clamp(c*exposure,0.0,1.0)*65535.0)/65535.0;if(curveEnabled)c=vec3(curve(c.r),curve(c.g),curve(c.b));if(any(notEqual(balance,vec3(0.0))))c=q16(colorBalance(c,balance));float luma=dot(c,vec3(0.2126,0.7152,0.0722));c=q16(vec3(luma)+(c-vec3(luma))*saturation);}result=vec4(clamp(c,0.0,1.0),1.0);}`});
    this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material));this.camera=new THREE.Camera();
    this.audio=new AudioContext();this.audioSource=this.audio.createMediaElementSource(video);this.gain=this.audio.createGain();this.analyser=this.audio.createAnalyser();this.analyser.fftSize=2048;this.audioSource.connect(this.gain).connect(this.analyser).connect(this.audio.destination);
    this.maxSize=1280;this.decodeLoads=0;this.frames=0;this.version=0;this.draw=()=>{this.frameCallback=video.requestVideoFrameCallback(()=>{if(this.clip){if(this.edit&&!video.paused&&video.currentTime>=this.edit.trimEnd-.015){video.pause();this.ended();}this.render();if(!this.loading&&!video.seeking)this.onTime(video.currentTime);}this.draw();});};this.draw();
    video.addEventListener('seeked',()=>this.render());video.addEventListener('loadeddata',()=>this.render());video.addEventListener('ended',()=>this.ended());
  }
  parseCameraLut(text){
    const parsed=this.loader.parse(text.replace(/\r/g,'').replace(/[\t ]+/g,' ').trim());
    const data=parsed.texture3D.image.data;
    for(let i=3;i<data.length;i+=4)if(data[i]!==1){parsed.texture3D.dispose();throw new Error('The camera LUT is incomplete.');}
    return parsed.texture3D;
  }
  curveTexture(data){const t=new THREE.DataTexture(data,256,256,THREE.RedFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.NearestFilter;t.needsUpdate=true;return t;}
  texture(data,size){const t=new THREE.Data3DTexture(data,size,size,size);t.type=THREE.FloatType;t.format=THREE.RGBAFormat;t.minFilter=t.magFilter=THREE.NearestFilter;t.unpackAlignment=1;t.needsUpdate=true;return t;}
  async load(clip,time){
    if(this.clip?.id===clip.id){if(this.loading)await this.loading;return;}
    this.clear();this.clip=clip;this.pendingSeek=time;const token=++this.loadToken,signal=this.loadAbort.signal;this.decodeLoads++;
    this.loading=(async()=>{const {url}=await this.api.sourceVideo(clip.id);if(token!==this.loadToken)return;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>fail(),10000);
        const clean=()=>{clearTimeout(timer);this.video.removeEventListener('loadeddata',ok);this.video.removeEventListener('error',fail);signal.removeEventListener('abort',cancel);};
        const ok=()=>{clean();resolve();};const fail=()=>{clean();reject(new Error('This clip could not be decoded by macOS. Its original file and export settings are unchanged.'));};const cancel=()=>{clean();reject(new Error('Preview cancelled'));};
        this.video.addEventListener('loadeddata',ok,{once:true});this.video.addEventListener('error',fail,{once:true});signal.addEventListener('abort',cancel,{once:true});this.video.src=url;this.video.load();
      });
      if(token!==this.loadToken)return;
      this.fit();this.canvas.hidden=false;
      this.seek(this.pendingSeek);this.render();
    })();try{await this.loading;}catch(error){if(token===this.loadToken)this.clear();throw error;}finally{if(token===this.loadToken)this.loading=null;}
  }
  // Canvas size only. The color pipeline is the same at every size.
  fit(){if(!this.video.videoWidth)return;const scale=Math.min(1,this.maxSize/this.video.videoWidth,this.maxSize/this.video.videoHeight);this.renderer.setSize(Math.round(this.video.videoWidth*scale),Math.round(this.video.videoHeight*scale),false);}
  setMaxSize(size){if(size===this.maxSize)return;this.maxSize=size;if(this.clip&&!this.loading){this.fit();this.render();}}
  // Reports the end of the trimmed range once per clip load.
  ended(){if(!this.clip||this.endedClip===this.loadToken)return;this.endedClip=this.loadToken;this.onEnd?.(this.clip);}
  clear(){this.loadAbort?.abort();this.loadAbort=new AbortController();this.loadToken=(this.loadToken||0)+1;this.video.pause();this.video.removeAttribute('src');this.video.load();this.canvas.hidden=true;this.clip=null;}
  seek(time){this.pendingSeek=time;if(this.video.readyState&&Math.abs(this.video.currentTime-time)>.025)this.video.currentTime=Math.max(0,Math.min(time,this.video.duration-.025));}
  render(){if(!this.video.videoWidth||this.video.readyState<2)return;this.videoTexture.needsUpdate=true;this.renderer.render(this.scene,this.camera);this.frames++;this.canvas.dataset.renderVersion=String(this.version);this.canvas.dataset.gradeReady=String(this.appliedToneKey===this.toneKey&&this.appliedCameraKey===this.cameraKey);this.canvas.dataset.mediaTime=String(this.video.currentTime);this.canvas.dispatchEvent(new Event('grade-rendered'));}
  setGrade(clip,edit,before=false){
    this.edit={...edit};this.version++;const profile=edit.profile==='auto'?clip.profile:edit.profile;
    this.uniforms.before.value=before||profile==='Unknown'||profile==='HLG';this.uniforms.exposure.value=2**edit.exposure;this.uniforms.strength.value=profile==='Normal'?0:edit.lutStrength/100;
    this.uniforms.balance.value.set(edit.warmth*.001+edit.tint*.0004,-edit.tint*.0008,-edit.warmth*.001+edit.tint*.0004);this.uniforms.saturation.value=1+edit.saturation/100;this.uniforms.curveEnabled.value=Boolean(edit.brilliance||edit.contrast||edit.shadows||edit.highlights);
    this.gain.gain.value=edit.mute?0:10**((edit.gainDb||0)/20);
    const cameraKey=profile+(edit.vivid?'vivid':'');
    const cameraChanged=cameraKey!==this.cameraKey;this.cameraKey=cameraKey;
    if(['Unknown','HLG','Normal'].includes(profile)){this.uniforms.camera.value=this.identity;this.uniforms.cameraSize.value=2;this.appliedCameraKey=cameraKey;}
    else if(cameraChanged){
      const promise=this.lutCache.get(cameraKey)||this.api.cameraLut({id:clip.id,settings:edit}).then(text=>text?this.parseCameraLut(text):this.identity);
      this.lutCache.set(cameraKey,promise);promise.then(t=>{if(cameraKey!==this.cameraKey)return;t.minFilter=t.magFilter=THREE.NearestFilter;this.uniforms.camera.value=t;this.uniforms.cameraSize.value=t.image.width;this.appliedCameraKey=cameraKey;this.render();}).catch(error=>this.onError?.(error));
    }
    const toneKeys=['brilliance','contrast','shadows','highlights'];const key=JSON.stringify(toneKeys.map(k=>edit[k]||0));
    if(key!==this.toneKey){this.toneKey=key;this.pendingTone={key,clipId:clip.id,settings:{...edit}};this.pumpTone();}
    this.render();
  }
  async pumpTone(){
    if(this.toneBusy)return;this.toneBusy=true;
    try{while(this.pendingTone){const next=this.pendingTone;this.pendingTone=null;let result;try{result=await this.api.tonalLut({settings:next.settings});}catch(error){this.onError?.(error);continue;}
      if(next.clipId!==this.clip?.id&&next.key!==this.toneKey)continue;
      const bytes=Uint8Array.from(atob(result.data),c=>c.charCodeAt(0));const view=new DataView(bytes.buffer),data=new Float32Array(65536);
      for(let i=0;i<65536;i++)data[i]=view.getUint16(i*2,true)/65535;
      this.tone.dispose();this.tone=this.curveTexture(data);this.uniforms.tone.value=this.tone;this.appliedToneKey=next.key;this.render();
    }}catch(error){this.onError?.(error);}finally{this.toneBusy=false;}
  }
  async play(){const token=this.loadToken;await this.audio.resume();if(token!==this.loadToken)return;if(this.video.currentTime>=this.edit.trimEnd-.03||this.video.currentTime<this.edit.trimStart)this.seek(this.edit.trimStart);this.endedClip=null;await this.video.play();}
  rms(){const values=new Float32Array(this.analyser.fftSize);this.analyser.getFloatTimeDomainData(values);return Math.sqrt(values.reduce((sum,x)=>sum+x*x,0)/values.length);}
}
