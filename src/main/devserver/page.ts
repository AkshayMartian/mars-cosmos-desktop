/** The page the emailed reset link opens (development stand-in for the portal's /reset-pin page). Self-contained: one HTML file, no libraries. */
export const RESET_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Choose a new PIN · MARS Cosmos</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F5F3F0;color:#1C1917;font:16px/1.5 "Segoe UI",system-ui,sans-serif}
.card{background:#fff;border:1px solid #E2DDD6;border-radius:18px;padding:32px;width:100%;max-width:420px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;margin:16px}
h1{margin:0;font-size:28px}.muted{color:#57534E}.hint{font-size:13px;color:#57534E}
.f label{display:block;font-size:14px;font-weight:600;color:#57534E;margin-bottom:6px}
.box{position:relative}
input{width:100%;box-sizing:border-box;min-height:56px;padding:0 70px 0 14px;border:1px solid #8A837C;border-radius:10px;font-size:24px;letter-spacing:.4em;background:#fff;color:#1C1917}
input:focus{outline:2px solid #B4441F;outline-offset:1px}
input.bad{border-color:#B91C1C}input.good{border-color:#15803D}
.tog{position:absolute;right:6px;top:50%;transform:translateY(-50%);min-height:40px;padding:0 10px;border:0;background:transparent;color:#8A3216;font:600 14px "Segoe UI",system-ui,sans-serif;cursor:pointer;letter-spacing:0}
.err{min-height:20px;margin-top:6px;font-size:13px;color:#B91C1C;font-weight:600}
.rules{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:14px;color:#57534E}
.rules li:before{content:"\\25CB";display:inline-block;width:22px}.rules li.ok{color:#15803D;font-weight:600}.rules li.ok:before{content:"\\2713"}
.top{color:#B91C1C;font-weight:600;font-size:14px;min-height:0}
button.save{min-height:52px;border:0;border-radius:12px;background:#B4441F;color:#fff;font-weight:700;font-size:17px;cursor:pointer}
button.save:disabled{opacity:.45;cursor:not-allowed}
</style></head><body><div class="card" id="c"><p class="muted">Checking your link…</p></div>
<script>
var token = new URLSearchParams(location.search).get('token') || '';
var c = document.getElementById('c');
var EASY = ['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123','1212'];
function show(html){ c.innerHTML = html; }
function dead(){ show('<h1>This link has expired</h1><p>A reset link works once and for 15 minutes. It may already have been used, or it is too old.</p><ol><li>Open Mars Cosmos on your shop PC.</li><li>Choose the Owner and tap Forgot PIN.</li><li>Open the new email and use the new link.</li></ol>'); }
function field(id, label){
  return '<div class="f"><label for="'+id+'">'+label+'</label><div class="box"><input id="'+id+'" type="password" inputmode="numeric" autocomplete="new-password" maxlength="4" aria-describedby="'+id+'e"><button type="button" class="tog" data-for="'+id+'" aria-label="Show or hide the PIN">Show</button></div><div class="err" id="'+id+'e" role="alert"></div></div>';
}
function form(shop, minutes){
  show('<div class="muted">'+(shop?shop.replace(/[<>&"]/g,'')+' · ':'')+'Owner</div><h1>Choose a new PIN</h1><div class="muted">This link works once and expires in '+minutes+' minutes.</div>'
   + field('p1','New PIN (4 digits)') + field('p2','Confirm new PIN')
   + '<ul class="rules" aria-label="PIN rules"><li id="r1">4 digits, numbers only</li><li id="r2">Not an easy PIN (1111, 1234, 0000...)</li><li id="r3">Both PINs match</li></ul>'
   + '<div class="top" id="top" role="alert"></div><button class="save" id="b" disabled>Save new PIN</button>'
   + '<div class="hint">Not you? Close this page: nothing changes until a PIN is saved.</div>');
  var p1=document.getElementById('p1'), p2=document.getElementById('p2'), b=document.getElementById('b'), top=document.getElementById('top');
  var touched={p1:false,p2:false}, tried=false;
  function set(id,msg,mark){ var e=document.getElementById(id+'e'); e.textContent=msg; var i=document.getElementById(id); i.className=msg?'bad':(mark?'good':''); }
  function tick(id,ok){ document.getElementById(id).className = ok ? 'ok' : ''; }
  function check(){
    var a=p1.value, d=p2.value;
    var four = /^[0-9]{4}$/.test(a), easy = four && EASY.indexOf(a) < 0, same = four && a === d && d.length === 4;
    tick('r1',four); tick('r2',easy); tick('r3',same);
    var m1 = '';
    if (touched.p1 || tried) { if (!a) m1 = 'Enter a 4-digit PIN.'; else if (a.length < 4) m1 = 'The PIN needs 4 digits (' + a.length + ' so far).'; }
    if (four && !easy) m1 = 'Not an easy PIN like 1111, 1234 or 0000. Choose another.';
    var m2 = '';
    if (d.length && (touched.p2 || tried || d.length === 4) && (d !== a.slice(0,d.length) || (d.length === 4 && d !== a))) m2 = 'The two PINs do not match.';
    else if (touched.p2 && !d.length && tried) m2 = 'Type the PIN again to confirm.';
    set('p1',m1,four&&easy); set('p2',m2,same);
    b.disabled = !(four && easy && same);
    return four && easy && same;
  }
  [p1,p2].forEach(function(i){
    i.addEventListener('input', function(){ var v=i.value.replace(/[^0-9]/g,'').slice(0,4); var removed = v !== i.value && i.value.length<=4 ? true : false; i.value=v; top.textContent=''; touched[i.id]=touched[i.id]||v.length===4; check(); if (removed) document.getElementById(i.id+'e').textContent='Numbers only.'; });
    i.addEventListener('blur', function(){ touched[i.id]=true; check(); });
    i.addEventListener('keydown', function(ev){ if (ev.key==='Enter'){ ev.preventDefault(); b.click(); } });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tog'), function(t){
    t.addEventListener('click', function(){ var i=document.getElementById(t.getAttribute('data-for')); var hide=i.type==='text'; i.type=hide?'password':'text'; t.textContent=hide?'Show':'Hide'; i.focus(); });
  });
  b.addEventListener('click', function(){
    tried=true; if (!check()) { (p1.value.length===4 ? p2 : p1).focus(); return; }
    b.disabled=true; top.textContent='';
    fetch('/v1/pin-reset/complete', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({token: token, pin: p1.value})})
      .then(function(r){ return r.json().then(function(j){ return {s:r.status, j:j}; }); })
      .then(function(r){
        if (r.s === 410) return dead();
        if (r.s !== 200) { top.textContent = r.j.error || 'Something went wrong. Try again.'; b.disabled = false; return; }
        show('<h1>PIN saved</h1><p>Go back to Mars Cosmos on your shop PC. It picks up the new PIN in a few seconds. Then log in with it.</p><div class="hint">We also sent you an email to confirm the change. If this was not you, call MARS support right away.</div>');
      })
      .catch(function(){ top.textContent = 'Could not reach the server. Check the connection and try again.'; b.disabled = false; });
  });
  p1.focus();
}
if (!token) dead(); else fetch('/v1/pin-reset/validate?token=' + encodeURIComponent(token))
  .then(function(r){ return r.json().then(function(j){ return {s:r.status, j:j}; }); })
  .then(function(r){ if (r.s === 200) form(r.j.shop, r.j.minutesLeft); else dead(); })
  .catch(function(){ show('<h1>Could not reach the server</h1><p>Check that Mars Cosmos is running on this PC.</p>'); });
</script></body></html>`
