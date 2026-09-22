'use strict';
document.getElementById('year').textContent=new Date().getFullYear();
const themeButton=document.getElementById('theme');
let lightTheme=false;
try { lightTheme=localStorage.getItem('portfolio-theme')==='light'; } catch (_) {}
function applyTheme(){document.documentElement.dataset.theme=lightTheme?'light':'dark';themeButton.textContent=lightTheme?'☾ Dark':'☀ Light';themeButton.setAttribute('aria-label',lightTheme?'Switch to dark theme':'Switch to light theme');themeButton.setAttribute('aria-pressed',String(lightTheme));window.dispatchEvent(new Event('portfolio-theme-change'));}
themeButton.addEventListener('click',()=>{lightTheme=!lightTheme;try{localStorage.setItem('portfolio-theme',lightTheme?'light':'dark')}catch(_){}applyTheme()});
applyTheme();
const tabs=[...document.querySelectorAll('[data-page]')];
function showPage(id){if(!document.getElementById(id)?.classList.contains('page'))id='about';document.querySelectorAll('.page').forEach(p=>{p.hidden=p.id!==id;p.classList.toggle('active',p.id===id)});tabs.forEach(t=>{t.classList.toggle('active',t.dataset.page===id);if(t.dataset.page===id)t.setAttribute('aria-current','page');else t.removeAttribute('aria-current')});}
function navigatePage(id){
  const x=window.scrollX,y=window.scrollY;
  showPage(id);
  const url=new URL(location.href);
  url.hash='';url.searchParams.set('section',id);
  history.pushState(null,'',url);
  window.scrollTo({left:x,top:y,behavior:'instant'});
}
function pageFromUrl(){return new URLSearchParams(location.search).get('section')||location.hash.slice(1)||'about';}
tabs.forEach(t=>t.addEventListener('click',()=>navigatePage(t.dataset.page)));
document.querySelectorAll('[data-go]').forEach(t=>t.addEventListener('click',()=>navigatePage(t.dataset.go)));
window.addEventListener('popstate',()=>showPage(pageFromUrl()));
window.addEventListener('hashchange',()=>showPage(pageFromUrl()));
showPage(pageFromUrl());
if(location.hash){const url=new URL(location.href);url.searchParams.set('section',pageFromUrl());url.hash='';history.replaceState(null,'',url);}

const canvas=document.getElementById('water'),motion=document.getElementById('motion'),dropButton=document.getElementById('drop');
const gl=canvas.getContext('webgl',{alpha:false,antialias:false,powerPreference:'low-power'});
let paused=false;
function syncMotion(){motion.textContent=paused?'▶':'Ⅱ';motion.setAttribute('aria-pressed',String(paused));motion.setAttribute('aria-label',paused?'Resume water animation':'Pause water animation');}
syncMotion();
if(gl){
const vs='attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const fs=`precision mediump float;
uniform vec2 res;uniform float time;uniform float lightMode;uniform vec3 drops[12];
float height(vec2 p){float h=.014*sin(p.x*5.+time*.28)*cos(p.y*6.-time*.21)+.006*sin(p.x*15.+p.y*8.+time*.36);for(int i=0;i<12;i++){float age=time-drops[i].z;float d=length(p-drops[i].xy);float front=d-age*.36;float envelope=exp(-front*front*65.)*exp(-age*.48);if(age>=0.&&age<13.)h+=.055*cos(front*42.)*envelope;}return h;}
void main(){vec2 uv=gl_FragCoord.xy/res;vec2 p=(uv-.5)*vec2(res.x/res.y,1.)*3.;float h=height(p);float e=.012;vec3 n=normalize(vec3((h-height(p+vec2(e,0.)))/e,(h-height(p+vec2(0.,e)))/e,1.));vec3 light=normalize(vec3(-.6,.85,1.));float glow=pow(max(dot(n,light),0.),6.);float shine=pow(max(dot(n,normalize(vec3(.4,.6,1.))),0.),24.);float bands=.5+.5*sin(p.x*2.+p.y*3.+n.x*4.);vec3 color=mix(vec3(.035,.09,.13),vec3(.15,.32,.38),glow);color+=vec3(.22,.31,.30)*shine+vec3(.01,.028,.035)*bands;float vignette=1.-.3*length(uv-.5);vec3 pale=mix(vec3(.65,.78,.80),vec3(.89,.94,.93),glow)+vec3(.08)*shine;color=mix(color*vignette,pale,lightMode);gl_FragColor=vec4(color,1.);}`;
function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
try{const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Water shader unavailable');gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const pos=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);const lightUniform=gl.getUniformLocation(program,'lightMode');const r=gl.getUniformLocation(program,'res'),t=gl.getUniformLocation(program,'time'),d=gl.getUniformLocation(program,'drops[0]');const drops=new Float32Array(36);for(let i=0;i<12;i++)drops[i*3+2]=-100;let index=0,simTime=0,last=performance.now(),lastDraw=0;
function resize(){const scale=Math.min(devicePixelRatio,1);canvas.width=Math.floor(innerWidth*scale);canvas.height=Math.floor(innerHeight*scale);gl.viewport(0,0,canvas.width,canvas.height);render();}
function render(){gl.uniform1f(lightUniform,lightTheme?1:0);gl.uniform2f(r,canvas.width,canvas.height);gl.uniform1f(t,simTime);gl.uniform3fv(d,drops);gl.drawArrays(gl.TRIANGLES,0,6);}
function ripple(x,y){if(paused)return;drops[index*3]=(x/innerWidth-.5)*(innerWidth/innerHeight)*3;drops[index*3+1]=(.5-y/innerHeight)*3;drops[index*3+2]=simTime;index=(index+1)%12;render();}
window.addEventListener('pointerdown',e=>{ripple(e.clientX,e.clientY)});dropButton.addEventListener('click',()=>{if(paused){paused=false;syncMotion()}ripple(innerWidth*.06,innerHeight*.4)});motion.addEventListener('click',()=>{paused=!paused;syncMotion()});window.addEventListener('resize',resize);window.addEventListener('portfolio-theme-change',render);resize();ripple(innerWidth*.8,innerHeight*.2);
function frame(now){let dt=Math.min((now-last)/1000,.1);last=now;if(!paused&&!document.hidden){simTime+=dt;if(now-lastDraw>32){render();lastDraw=now}}requestAnimationFrame(frame)}requestAnimationFrame(frame);
}catch(e){canvas.style.display='none';motion.hidden=true;dropButton.textContent='Water preview unavailable';dropButton.disabled=true;console.warn(e.message)}
}else{motion.hidden=true;dropButton.textContent='Water preview unavailable';dropButton.disabled=true;}
