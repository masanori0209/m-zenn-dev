#!/usr/bin/env node
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const imagesDir = process.env.ZENN_IMAGES_DIR ?? path.join(root, "images");

const shots = [
  {
    url: "http://127.0.0.1:5173/",
    out: path.join(imagesDir, "typescript-version-benchmark-ui.png"),
    waitFor: "text=TaskFlow",
    fullPage: true,
  },
  {
    url: `file://${path.join(root, "scripts/capture-typescript-benchmark-media.html")}`,
    out: path.join(imagesDir, "typescript-version-benchmark-results.png"),
    waitFor: "table",
    fullPage: false,
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

for (const shot of shots) {
  await page.goto(shot.url, { waitUntil: "networkidle" });
  await page.waitForSelector(shot.waitFor);
  await page.screenshot({ path: shot.out, fullPage: shot.fullPage });
  console.log(`saved ${shot.out}`);
}

await browser.close();
