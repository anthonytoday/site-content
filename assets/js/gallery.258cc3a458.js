(function(){
var el = document.getElementById('lb-data');
if (!el) return;
var cfg;
try { cfg = JSON.parse(el.textContent); } catch (e) { return; }
var SLIDES = cfg.s || [], ALT = cfg.a || '';
var lb = document.getElementById('lb'), img = document.getElementById('lb-img'),
now = document.getElementById('lb-now'), i = 0, lastFocus = null;
if (!lb || !SLIDES.length) return;
var single = SLIDES.length < 2;
if (single) lb.querySelectorAll('.lb-nav').forEach(function(b){ b.hidden = true; });
function show(n){
i = (n + SLIDES.length) % SLIDES.length;
img.src = SLIDES[i];
img.alt = ALT + ' (' + (i+1) + ')';
now.textContent = i + 1;
document.querySelectorAll('.gallery-thumbs .gthumb').forEach(function(t){
t.classList.toggle('on', t.getAttribute('data-lb-index') == String(i));
});
}
function open(n){
lastFocus = document.activeElement;
show(n); lb.hidden = false; lb.setAttribute('aria-hidden','false');
document.body.style.overflow = 'hidden';
lb.querySelector('.lb-close').focus();
}
function close(){
lb.hidden = true; lb.setAttribute('aria-hidden','true');
document.body.style.overflow = '';
if (lastFocus) lastFocus.focus();
}
document.addEventListener('click', function(e){
var o = e.target.closest('.lb-open');
if (o){ e.preventDefault(); open(parseInt(o.getAttribute('data-lb-index'),10) || 0); return; }
if (e.target.closest('[data-lb-close]') || e.target === lb){ close(); return; }
if (e.target.closest('[data-lb-prev]')){ show(i-1); return; }
if (e.target.closest('[data-lb-next]')){ show(i+1); return; }
});
document.addEventListener('keydown', function(e){
var o = e.target.closest && e.target.closest('.lb-open');
if (o && (e.key === 'Enter' || e.key === ' ')){
e.preventDefault(); open(parseInt(o.getAttribute('data-lb-index'),10) || 0); return;
}
if (lb.hidden) return;
if (e.key === 'Escape') close();
else if (!single && e.key === 'ArrowLeft') show(i-1);
else if (!single && e.key === 'ArrowRight') show(i+1);
});
var x0 = null;
lb.addEventListener('touchstart', function(e){ x0 = e.changedTouches[0].clientX; }, {passive:true});
lb.addEventListener('touchend', function(e){
if (x0 === null || single) return;
var dx = e.changedTouches[0].clientX - x0;
if (Math.abs(dx) > 45) show(dx > 0 ? i-1 : i+1);
x0 = null;
}, {passive:true});
})();