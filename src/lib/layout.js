// Shared HTML shells — public site + portal pages. All pages share /app.css and /app.js.
const DISCLAIMER = 'Student project proposal — not officially approved or endorsed by HITEC Schools & Colleges.';

function head(title, desc) {
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
${desc ? `<meta name="description" content="${desc}">` : ''}
<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0A5C99">
<link rel="icon" href="/icon-192.png" type="image/png"><link rel="apple-touch-icon" href="/icon-192.png">
<link rel="stylesheet" href="/app.css">
<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}</script>`;
}

function publicShell({ title, desc, body, active }) {
  const a = (p) => active === p ? ' style="color:#FFD21F;opacity:1"' : '';
  return `<!doctype html><html lang="en"><head>${head(title, desc)}</head><body>
<nav class="nav" id="nav"><div class="nav-inner">
<a class="brand" href="/"><img src="/logo.png" alt="HITEC logo"><span>HITEC Smart Campus<small>STUDENT PROJECT</small></span></a>
<div class="nav-links">
<a href="/"${a('home')}>Home</a><a href="/#portals"${a('portals')}>Portals</a><a href="/#gallery"${a('gallery')}>Campus</a><a href="/notices"${a('notices')}>Notices</a>
<a class="nav-cta" href="/login">Open portals</a>
</div></div></nav>
${body}
<footer class="footer"><div class="foot-grid">
<div><div class="foot-brand"><img src="/logo.png" alt="HITEC logo">HITEC Smart Campus</div>
<p style="font-size:.85rem;line-height:1.6;margin:0">Attendance, results, fines &amp; parent-teacher connection — one secure system proposed for HITEC Schools &amp; Colleges, Taxila Cantt.</p></div>
<div><h4>Portals</h4><a href="/login">Management login</a><a href="/login">Teacher login</a><a href="/login">Student login</a><a href="/login">Parent login</a></div>
<div><h4>Explore</h4><a href="/#features">Features</a><a href="/#gallery">Campus gallery</a><a href="/notices">Notices</a><a href="/#contact">Contact</a></div>
<div><h4>Institution</h4><a href="https://hitec.edu.pk/" target="_blank" rel="noopener">hitec.edu.pk</a><a href="https://hitec.edu.pk/picture-gallery/" target="_blank" rel="noopener">Official gallery</a><span style="font-size:.85rem">📞 +92-51-9043100</span></div>
</div>
<div class="foot-bottom">${DISCLAIMER}<br>All demo data is fictional. Proposed branding only — not the official logo.</div>
</footer>
<script src="/app.js"></script></body></html>`;
}

// links: [[href,label],...]
function portalShell({ title, user, links, body, home }) {
  const here = links.map(([h, l]) => `<a href="${h}">${l}</a>`).join('');
  return `<!doctype html><html lang="en"><head>${head(title + ' — HITEC Smart Campus')}</head><body>
<div class="pbar"><div class="pbar-inner">
<a class="brand" href="${home}"><img src="/logo.png" alt="logo"><span style="font-size:.85rem">${title}</span></a>
<nav class="plinks">${here}</nav>
<div class="puser"><span class="chip">${user.login} · ${user.role.replace(/_/g, ' ')}</span>
<form class="inline" method="post" action="/logout"><button class="btn small ghost" style="border-color:rgba(255,255,255,.4)">Logout</button></form></div>
</div></div>
<div class="pwrap">${body}</div>
<script src="/app.js"></script></body></html>`;
}

module.exports = { head, publicShell, portalShell, DISCLAIMER };
