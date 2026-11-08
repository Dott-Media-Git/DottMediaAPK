const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'docs');
const destDir = path.join(root, 'dist', 'help');

if (!fs.existsSync(sourceDir)) {
  console.error(`Help docs source not found: ${sourceDir}`);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });

const files = fs
  .readdirSync(sourceDir)
  .filter((name) => {
    const lower = name.toLowerCase();
    return lower.endsWith('.pdf') || lower.endsWith('.html');
  });

if (!files.length) {
  console.warn('No PDF help docs found to copy.');
  process.exit(0);
}

files.forEach((file) => {
  fs.copyFileSync(path.join(sourceDir, file), path.join(destDir, file));
});

const logoSource = path.join(root, 'assets', 'logo.png');
if (fs.existsSync(logoSource)) {
  fs.copyFileSync(logoSource, path.join(destDir, 'logo.png'));
}

console.log(`Copied ${files.length} help docs to ${destDir}`);

// Expo's generated web shell has an empty root until JavaScript starts. Keep a
// lightweight, accessible splash in that root; React replaces it on mount.
const indexFile = path.join(root, 'dist', 'index.html');
const html = fs.readFileSync(indexFile, 'utf8');
const marker = '<div id="root"></div>';
if (!html.includes(marker)) throw new Error('Expo web root was not found; cannot add loading screen');
const splash = `<style>
  html,body{background:#070916;color:#f7f4ff}
  .dotti-startup{width:100%;min-height:100%;display:grid;place-items:center;padding:24px;box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif;background:radial-gradient(circle at 50% 20%,#251747,#070916 65%)}
  .dotti-startup-card{text-align:center;width:min(100%,440px);padding:42px 24px;border:1px solid #332752;border-radius:28px;background:#10152c;box-shadow:0 24px 70px #0006}
  .dotti-startup-icons{display:flex;justify-content:center;align-items:center;gap:15px;margin-bottom:26px}
  .dotti-startup-icon{width:68px;height:68px;display:grid;place-items:center;border-radius:21px;font-size:32px;font-weight:800;color:white;box-shadow:0 10px 25px #0005}
  .dotti-startup-instagram{background:linear-gradient(135deg,#8f3be8,#e83991,#fa994b)}
  .dotti-startup-brand{background:linear-gradient(145deg,#a365ff,#6937ed)}
  .dotti-startup-dots{display:flex;gap:5px}.dotti-startup-dots span{width:7px;height:7px;border-radius:50%;background:#c1a5ff;animation:dotti-pulse 1.2s infinite}.dotti-startup-dots span:nth-child(2){animation-delay:.2s}.dotti-startup-dots span:nth-child(3){animation-delay:.4s}
  .dotti-startup h1{font-size:22px;margin:0 0 10px}.dotti-startup p{color:#bac0dc;line-height:1.55;margin:0}.dotti-startup small{display:block;color:#939ab9;margin-top:20px}
  .dotti-instagram-only{display:none}.instagram-return .dotti-instagram-only{display:grid}.instagram-return .dotti-generic-only{display:none}
  @keyframes dotti-pulse{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1.2)}}
  @media(prefers-reduced-motion:reduce){.dotti-startup-dots span{animation:none;opacity:1}}
</style>
<div id="root"><main class="dotti-startup" role="status" aria-live="polite"><div class="dotti-startup-card"><div class="dotti-startup-icons" aria-hidden="true"><div class="dotti-startup-icon dotti-startup-instagram dotti-instagram-only">◎</div><div class="dotti-startup-dots"><span></span><span></span><span></span></div><div class="dotti-startup-icon dotti-startup-brand">D</div></div><h1 class="dotti-generic-only">Loading Dotti</h1><h1 class="dotti-instagram-only">Connecting Instagram to Dotti</h1><p>Getting everything ready. This may take a moment.</p><small>Please keep this page open.</small></div></main></div>
<script>if(new URLSearchParams(location.search).get('connected')==='instagram')document.documentElement.classList.add('instagram-return');</script>`;
fs.writeFileSync(indexFile, html.replace(marker, splash));
console.log('Added Dotti web loading screen.');
