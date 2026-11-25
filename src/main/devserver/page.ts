/** The page the emailed reset link opens (development stand-in for the portal's /reset-pin page). Self-contained: one HTML file, no libraries. */
export const RESET_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Choose a new PIN · MARS Cosmos</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F5F3F0;color:#1C1917;font:16px/1.5 "Segoe UI",system-ui,sans-serif}
.card{background:#fff;border:1px solid #E2DDD6;border-radius:18px;padding:32px;width:100%;max-width:420px;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;margin:16px}
h1{margin:0;font-size:28px}.muted{color:#57534E}.hint{font-size:13px;color:#57534E}.err{font-size:13px;color:#B91C1C;font-weight:600}
label{font-size:14px;font-weight:600;color:#57534E;display:block;margin-bottom:6px}
input{width:100%;box-sizing:border-box;min-height:56px;padding:0 14px;border:1px solid #8A837C;border-radius:10px;font-size:24px;letter-spacing:.4em}
button{min-height:52px;border:0;border-radius:12px;background:#B4441F;color:#fff;font-weight:700;font-size:17px;cursor:pointer}button:disabled{opacity:.5}
</style></head><body><div class="card" id="c"><p class="muted">Checking your link…</p></div>
<script>
var token = new URLSearchParams(location.search).get('token') || '';
var c = document.getElementById('c');
function show(html){ c.innerHTML = html; }
function dead(){ show('<h1>This link has expired</h1><p>A reset link works once and for 15 minutes. It may already have been used, or it is too old.</p><ol><li>Open Mars Cosmos on your shop PC.</li><li>Choose the Owner and tap Forgot PIN.</li><li>Open the new email and use the new link.</li></ol>'); }
function form(shop, minutes){
  show('<div class="muted">'+(shop?shop.replace(/[<>&]/g,'')+' · ':'')+'Owner</div><h1>Choose a new PIN</h1><div class="muted">This link works once and expires in '+minutes+' minutes.</div>'
   +'<div><label for="p1">New PIN (4 digits)</label><input id="p1" type="password" inputmode="numeric" maxlength="4" autofocus></div>'
   +'<div><label for="p2">Confirm new PIN</label><input id="p2" type="password" inputmode="numeric" maxlength="4"></div>'
   +'<div class="err" id="e" role="alert"></div><button id="b">Save new PIN</button><div class="hint">Exactly 4 digits. Not an easy PIN like 1111, 1234 or 0000. Not you? Close this page: nothing changes until a PIN is saved.</div>');
  var p1=document.getElementById('p1'), p2=document.getElementById('p2'), e=document.getElementById('e'), b=document.getElementById('b');
  [p1,p2].forEach(function(i){ i.addEventListener('input', function(){ i.value = i.value.replace(/[^0-9]/g,'').slice(0,4); }); });
  b.addEventListener('click', function(){
    if (p1.value.length !== 4) { e.textContent = 'Exactly 4 digits.'; return; }
    if (p1.value !== p2.value) { e.textContent = 'The two PINs do not match.'; return; }
    b.disabled = true; e.textContent = '';
    fetch('/v1/pin-reset/complete', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({token: token, pin: p1.value})})
      .then(function(r){ return r.json().then(function(j){ return {s:r.status, j:j}; }); })
      .then(function(r){
        if (r.s === 410) return dead();
        if (r.s !== 200) { e.textContent = r.j.error || 'Something went wrong. Try again.'; b.disabled = false; return; }
        show('<h1>PIN saved</h1><p>Go back to Mars Cosmos on your shop PC. It picks up the new PIN in a few seconds. Then log in with it.</p><div class="hint">We also sent you an email to confirm the change. If this was not you, call MARS support right away.</div>');
      })
      .catch(function(){ e.textContent = 'Could not reach the server.'; b.disabled = false; });
  });
}
if (!token) dead(); else fetch('/v1/pin-reset/validate?token=' + encodeURIComponent(token))
  .then(function(r){ return r.json().then(function(j){ return {s:r.status, j:j}; }); })
  .then(function(r){ if (r.s === 200) form(r.j.shop, r.j.minutesLeft); else dead(); })
  .catch(function(){ show('<h1>Could not reach the server</h1><p>Check that Mars Cosmos is running on this PC.</p>'); });
</script></body></html>`
