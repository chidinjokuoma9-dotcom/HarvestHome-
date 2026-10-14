const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const allowedFiles = new Set(['index.html', 'App.js', 'Style.css']);
const adScriptUrl = 'https://bauval.org/22/83a4f890a6b4866344289fc3dd470ed2';
let server;

function configStub() {
  return `window.HARVESTHOME_CONFIG = {
    APP_NAME: "HarvestHome", VERSION: "V8",
    SUPABASE_URL: "", SUPABASE_ANON_KEY: "",
    DEFAULT_COUNTRY: "Nigeria", DEFAULT_CURRENCY: "NGN",
    MAX_IMAGE_FILES: 6, MAX_VIDEO_FILES: 1, MAX_VIDEO_MB: 25,
    SUPPORTED_COUNTRIES: [
      {name:"Nigeria",code:"NG",currency:"NGN",symbol:"₦"},
      {name:"Ghana",code:"GH",currency:"GHS",symbol:"GH₵"}
    ],
    CATEGORIES: ["All categories","Houses","Land","Equipment","Farm Produce"],
    MODES: ["All","Sale","Lease"],
    LOCATIONS: {Nigeria:["All locations","Abuja","Lagos"],Ghana:["All locations","Accra"]}
  };`;
}

async function main() {
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!allowedFiles.has(filename)) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const fullPath = path.join(root, filename);
    res.writeHead(200, {'Content-Type': filename.endsWith('.js') ? 'text/javascript; charset=utf-8' : filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'});
    fs.createReadStream(fullPath).pipe(res);
  });
  await new Promise(resolve => server.listen(4174, '127.0.0.1', resolve));

  const browser = await chromium.launch({headless:true});
  try {
    for (const viewport of [{name:'desktop',width:1365,height:900},{name:'mobile',width:360,height:800}]) {
      const context = await browser.newContext({viewport:{width:viewport.width,height:viewport.height}, serviceWorkers:'block'});
      const page = await context.newPage();
      const pageErrors = [];
      const popups = [];
      let adScriptResponseStatus = null;
      page.on('pageerror', e => pageErrors.push(e.message));
      page.on('popup', popup => popups.push(popup.url()));
      page.on('response', response => {
        if (response.url() === adScriptUrl) adScriptResponseStatus = response.status();
      });

      // This test uses a local app with a stubbed config and Supabase client.
      // Google AdSense is blocked; only the Adsterra code is loaded from its real origin.
      await page.route('**/Config.js*', route => route.fulfill({status:200,contentType:'text/javascript',body:configStub()}));
      await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route => route.fulfill({status:200,contentType:'text/javascript',body:'window.supabase={createClient:()=>null};'}));
      await page.route('https://pagead2.googlesyndication.com/**', route => route.abort());
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname.endsWith('.supabase.co') || url.hostname === 'supabase.co') return route.abort();
        if (url.hostname === 'bauval.org' || url.hostname.endsWith('.bauval.org')) return route.continue();
        if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
        // Allow third-party resources requested by the real banner creative, but no production backend.
        return route.continue();
      });

      await page.goto('http://127.0.0.1:4174/', {waitUntil:'domcontentloaded'});
      await page.waitForSelector('#harvesthome-adsterra-section', {timeout:15000});
      await page.waitForFunction(() => {
        const slot = document.querySelector('#harvesthome-adsterra-banner');
        return !!slot && !!slot.querySelector('script[src*="bauval.org/22/"]');
      }, null, {timeout:15000});
      await page.waitForTimeout(8000);

      assert.equal(await page.locator('#harvesthome-adsterra-section').count(), 1, viewport.name + ': one labeled banner section');
      assert.equal(await page.locator('#harvesthome-adsterra-banner script').count(), 1, viewport.name + ': one Adsterra script element');
      assert.equal(await page.locator('#harvesthome-adsterra-section').getByText('Advertisement').count(), 1, viewport.name + ': ad label visible');
      assert.equal(new URL(page.url()).hostname, '127.0.0.1', viewport.name + ': main page did not navigate away');
      assert.deepEqual(popups, [], viewport.name + ': no popup windows opened');
      const dimensions = await page.locator('#harvesthome-adsterra-banner').evaluate(el => ({width:el.getBoundingClientRect().width,scrollWidth:el.scrollWidth,viewport:window.innerWidth}));
      assert.ok(dimensions.width <= dimensions.viewport, viewport.name + ': banner slot fits viewport');
      assert.ok(dimensions.scrollWidth <= dimensions.viewport, viewport.name + ': banner slot has no horizontal overflow');
      assert.deepEqual(pageErrors, [], viewport.name + ': no uncaught browser errors: ' + pageErrors.join('; '));

      if (adScriptResponseStatus === null) {
        console.log('NOTICE ' + viewport.name + ': real Adsterra script request did not produce an observable response in this runner; creative behavior could not be confirmed.');
      } else {
        console.log('INFO ' + viewport.name + ': real Adsterra script HTTP status ' + adScriptResponseStatus + '.');
        assert.ok(adScriptResponseStatus >= 200 && adScriptResponseStatus < 400, viewport.name + ': real Adsterra script returned a successful response');
      }
      console.log('PASS ' + viewport.name + ': isolated local app, no production Supabase requests, AdSense blocked, no top-level redirect/popups, no overflow or uncaught errors.');
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  if (server) server.close();
  process.exitCode = 1;
});
