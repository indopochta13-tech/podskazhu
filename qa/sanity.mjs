// Проверка самого перехватчика: намеренно вызываем 404 и JS-исключение
// и убеждаемся, что они попадают в отчёт. Иначе «ошибок нет» ничего не значит.
import { chromium } from "/tmp/soulvoice_test/node_modules/playwright/index.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jsErrors = [], consoleErrors = [], netErrors = [], logEntries = [];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 400, height: 860 } });
const page = await context.newPage();
page.on("pageerror", e => jsErrors.push("pageerror: " + e.message));
page.on("response", r => { if (r.status() >= 400) netErrors.push(`HTTP ${r.status()} ${r.url()}`); });

const cdp = await context.newCDPSession(page);
await cdp.send("Runtime.enable");
await cdp.send("Log.enable");
await cdp.send("Network.enable");
cdp.on("Runtime.exceptionThrown", e => jsErrors.push("CDP exceptionThrown: " + (e.exceptionDetails.exception?.description || e.exceptionDetails.text)));
cdp.on("Runtime.consoleAPICalled", e => { if (e.type === "error") consoleErrors.push("CDP console." + e.type + ": " + e.args.map(a => a.description ?? a.value).join(" ")); });
cdp.on("Log.entryAdded", e => logEntries.push(`${e.entry.level}/${e.entry.source}: ${e.entry.text}`));
cdp.on("Network.responseReceived", e => { if (e.response.status >= 400) netErrors.push(`CDP ${e.response.status} ${e.response.url}`); });

await page.goto("http://127.0.0.1:8791/", { waitUntil: "networkidle" });
await page.evaluate(() => { fetch("/api/nope"); });
await page.evaluate(() => { console.error("ТЕСТ console.error"); });
await page.evaluate(() => { setTimeout(() => { throw new Error("ТЕСТ необработанное исключение"); }, 0); });
await sleep(1200);

console.log("JS:", JSON.stringify(jsErrors, null, 1));
console.log("CONSOLE:", JSON.stringify(consoleErrors, null, 1));
console.log("NET:", JSON.stringify(netErrors, null, 1));
console.log("LOG:", JSON.stringify(logEntries, null, 1));
console.log("\nперехватчик работает:", jsErrors.length > 0 && consoleErrors.length > 0 && netErrors.length > 0 ? "ДА" : "НЕТ");
await browser.close();
