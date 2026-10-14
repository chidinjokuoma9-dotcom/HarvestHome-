const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const allowedFiles = new Set(['index.html', 'App.js', 'Style.css']);
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
  await new Promise(resolve => server.listen(4173, '127.0.0.1', resolve));

  const browser = await chromium.launch({headless:true});
  try {
    for (const viewport of [{name:'desktop',width:1365,height:900},{name:'mobile',width:360,height:800}]) {
      const context = await browser.newContext({viewport:{width:viewport.width,height:viewport.height}});
      const page = await context.newPage();
      let mockedAdScriptLoads = 0;
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(e.message));

      await page.route('https://**/*', route => route.abort());
      await page.route('**/Config.js*', route => route.fulfill({status:200,contentType:'text/javascript',body:configStub()}));
      await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route => route.fulfill({status:200,contentType:'text/javascript',body:'window.supabase={createClient:()=>null};'}));
      await page.route('https://pagead2.googlesyndication.com/**', route => route.abort());
      await page.route('https://bauval.org/22/83a4f890a6b4866344289fc3dd470ed2', route => {
        mockedAdScriptLoads++;
        return route.fulfill({status:200,contentType:'text/javascript',body:'window.__harvesthomeAdsterraMockLoaded=(window.__harvesthomeAdsterraMockLoaded||0)+1;'});
      });

      await page.goto('http://127.0.0.1:4173/', {waitUntil:'domcontentloaded'});
      await page.waitForSelector('#harvesthome-adsterra-section', {timeout:15000});
      await page.waitForFunction(() => window.__harvesthomeAdsterraMockLoaded === 1, {timeout:10000});

      const slot = page.locator('#harvesthome-adsterra-banner');
      assert.equal(await page.locator('#harvesthome-adsterra-section').count(), 1, viewport.name + ': one labeled banner section');
      assert.equal(await page.locator('#harvesthome-adsterra-section').getByText('Advertisement').count(), 1, viewport.name + ': ad label visible');
      assert.equal(await slot.count(), 1, viewport.name + ': one banner slot');
      assert.equal(await page.locator('#harvesthome-adsterra-banner script').count(), 1, viewport.name + ': one ad script');
      assert.equal(mockedAdScriptLoads, 1, viewport.name + ': one script load');
      const dimensions = await slot.evaluate(el => ({width:el.getBoundingClientRect().width,scrollWidth:el.scrollWidth,viewport:window.innerWidth}));
      assert.ok(dimensions.width <= dimensions.viewport, viewport.name + ': banner slot fits viewport');
      assert.ok(dimensions.scrollWidth <= dimensions.viewport, viewport.name + ': banner slot has no horizontal overflow');

      const home = page.locator('[data-a="home"]').first();
      if (await home.count()) await home.click();
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#harvesthome-adsterra-section').count(), 1, viewport.name + ': one section after rerender');
      assert.equal(await page.locator('#harvesthome-adsterra-banner script').count(), 1, viewport.name + ': no duplicate script after rerender');
      assert.equal(mockedAdScriptLoads, 1, viewport.name + ': script not reloaded after rerender');
      assert.deepEqual(pageErrors, [], viewport.name + ': no uncaught browser errors: ' + pageErrors.join('; '));

      console.log('PASS ' + viewport.name + ': marketplace rendered, mocked banner loaded once, no duplicate after rerender, no horizontal overflow, no uncaught browser errors.');
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
