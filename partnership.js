// ========== PARTICLES ==========
const canvas = document.getElementById('particles');
const ctx = canvas.getContext('2d');
let pts = [];
function resizeC(){canvas.width=innerWidth;canvas.height=document.body.scrollHeight}
resizeC();addEventListener('resize',resizeC);
for(let i=0;i<50;i++)pts.push({x:Math.random()*innerWidth,y:Math.random()*document.body.scrollHeight,s:Math.random()*2+.5,vy:-Math.random()*.3-.1,vx:(Math.random()-.5)*.2,o:Math.random()*.3+.05});
function drawP(){ctx.clearRect(0,0,canvas.width,canvas.height);pts.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,p.s,0,Math.PI*2);ctx.fillStyle=`rgba(245,190,11,${p.o})`;ctx.fill();p.y+=p.vy;p.x+=p.vx;if(p.y<0){p.y=canvas.height;p.x=Math.random()*canvas.width}});requestAnimationFrame(drawP)}
drawP();

// ========== NAV ==========
const sections=document.querySelectorAll('.section');
const dots=document.querySelectorAll('.nav-dot');
function scrollToSection(i){sections[i]?.scrollIntoView({behavior:'smooth'})}
addEventListener('scroll',()=>{
    document.getElementById('nav').classList.toggle('scrolled',scrollY>50);
    let c=0;sections.forEach((s,i)=>{if(scrollY>=s.offsetTop-300)c=i});
    dots.forEach((d,i)=>d.classList.toggle('active',i===c));
});

// ========== REVEAL ==========
const obs=new IntersectionObserver(e=>{e.forEach(x=>{if(x.isIntersecting)x.target.classList.add('visible')})},{threshold:.12});
document.querySelectorAll('.reveal,.rm-item').forEach(r=>obs.observe(r));

// ========== CALCULATOR ==========
const slider=document.getElementById('calcSlider');
slider.addEventListener('input',updateCalc);
function fmt(n){return n.toLocaleString('ru-RU')}
function updateCalc(){
    const subs=parseInt(slider.value),total=subs*490;
const str=Math.round(total*.6),ptr=Math.round(total*.25),inv=Math.round(total*.15);
    document.getElementById('calcSubs').textContent=fmt(subs);
    document.getElementById('calcTotal').textContent=fmt(total)+'₽';
    document.getElementById('calcStreamer').textContent=fmt(str)+'₽';
    document.getElementById('calcPartner').textContent=fmt(ptr)+'₽';
    document.getElementById('calcInvest').textContent=fmt(inv)+'₽';
    document.getElementById('calcAnnual').textContent='📅 в год: '+fmt(total*12)+'₽';
}
