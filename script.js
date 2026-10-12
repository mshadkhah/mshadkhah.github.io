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
