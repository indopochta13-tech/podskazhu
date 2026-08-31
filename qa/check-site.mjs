import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const results = [];

async function check(name, url, clickSel) {
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    const status = resp?.status();
    if (clickSel) {
      const el = await page.$(clickSel);
      if (!el) {
        results.push({ name, url, status, click: "NOT FOUND" });
        return;
      }
      const href = await el.getAttribute("href");
      results.push({ name, url, status, href, click: "found" });
    } else {
      results.push({ name, url, status });
    }
  } catch (e) {
    results.push({ name, url, error: e.message });
  }
}

await check("homepage", "https://soulvoicee.ru/");
await check("download btn hero", "https://soulvoicee.ru/", 'a.btn[href="/download/soulvoice.apk"]');
await check("install nav", "https://soulvoicee.ru/", 'a.top-link[href="#get"]');
await check("browser link footer", "https://soulvoicee.ru/", 'footer a[href="/app/"]');
await check("download page", "https://soulvoicee.ru/download/");
await check("download page apk btn", "https://soulvoicee.ru/download/", 'a.btn[href="/download/soulvoice.apk"]');
await check("download page app link", "https://soulvoicee.ru/download/", 'a[href="/app/"]');
await check("privacy", "https://soulvoicee.ru/privacy.html");
await check("privacy redirect", "https://soulvoicee.ru/privacy");
await check("offer", "https://soulvoicee.ru/offer.html");
await check("app pwa", "https://soulvoicee.ru/app/");

console.log(JSON.stringify(results, null, 2));
await browser.close();
