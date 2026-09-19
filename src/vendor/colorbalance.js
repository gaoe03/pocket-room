// GLSL translation of FFmpeg n8.0 libavfilter/vf_colorbalance.c.
// Copyright (c) 2013 Paul B Mahol. LGPL-2.1-or-later.
// Adapted to vec3 and one shared shadows/midtones/highlights value per channel.
// Preserve-lightness clipping behavior is intentionally retained, including its
// saturation discontinuity at adjusted min=0 or max=1. See accompanying source.
export const colorBalanceGLSL=`
float hfun(float n,float h,float s,float l){float a=s*min(l,1.0-l);float k=mod(n+h/30.0,12.0);return clamp(l-a*max(min(min(k-3.0,9.0-k),1.0),-1.0),0.0,1.0);}
vec3 colorBalance(vec3 c,vec3 balance){
 float l=max(max(c.r,c.g),c.b)+min(min(c.r,c.g),c.b);
 float shadow=clamp((0.333-l)*4.0+0.5,0.0,1.0)*0.7;
 float mid=clamp((l-0.333)*4.0+0.5,0.0,1.0)*clamp((1.0-l-0.333)*4.0+0.5,0.0,1.0)*0.7;
 float high=clamp((l+0.333-1.0)*4.0+0.5,0.0,1.0)*0.7;
 c=clamp(c+balance*shadow+balance*mid+balance*high,0.0,1.0);
 float hi=max(max(c.r,c.g),c.b),lo=min(min(c.r,c.g),c.b),h=0.0;
 l*=0.5;
 if(c.r==c.g&&c.g==c.b)h=0.0;
 else if(hi==c.r)h=60.0*(c.g-c.b)/(hi-lo);
 else if(hi==c.g)h=60.0*(2.0+(c.b-c.r)/(hi-lo));
 else h=60.0*(4.0+(c.r-c.g)/(hi-lo));
 if(h<0.0)h+=360.0;
 float sat=(hi==1.0||lo==0.0)?0.0:(hi-lo)/(1.0-abs(2.0*l-1.0));
 return vec3(hfun(0.0,h,sat,l),hfun(8.0,h,sat,l),hfun(4.0,h,sat,l));
}
`;
