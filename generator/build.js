/**
 * build.js — Static site generator buat Masakin.
 *
 * Alur kerjanya:
 *   1. Fetch data resep dari Web App Apps Script (?action=data)
 *   2. Ubah bentuk datanya jadi persis format yang dibutuhin template
 *      (recipeData di dalam index.html)
 *   3. Suntik data itu ke templates/index.html, di antara penanda
 *      BUILD:RECIPE_DATA_START / BUILD:RECIPE_DATA_END
 *   4. Simpan hasilnya ke folder site/ — INI yang di-upload ke Cloudflare Pages
 *
 * Dijalankan otomatis oleh GitHub Actions (.github/workflows/deploy.yml),
 * tapi juga bisa dites manual di komputer sendiri:
 *
 *   GAS_URL="https://script.google.com/macros/s/XXXXX/exec" node generator/build.js
 */

const fs = require('fs');
const path = require('path');

const GAS_URL = process.env.GAS_URL;
const TEMPLATE_PATH = path.join(__dirname, 'templates', 'index.html');
const OUTPUT_DIR = path.join(__dirname, '..', 'site');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'index.html');

const START_MARKER = '/* BUILD:RECIPE_DATA_START */';
const END_MARKER = '/* BUILD:RECIPE_DATA_END */';

async function main() {
  if (!GAS_URL) {
    throw new Error('Env var GAS_URL belum diset. Contoh: GAS_URL="https://script.google.com/macros/s/XXXXX/exec"');
  }

  console.log('Mengambil data dari Apps Script...');
  const res = await fetch(`${GAS_URL}?action=data`);
  if (!res.ok) {
    throw new Error(`Gagal fetch data, status: ${res.status}`);
  }
  const raw = await res.json();
  console.log(`Ditemukan ${raw.recipes.length} resep, ${raw.articles.length} artikel.`);

  const recipeData = buildRecipeData(raw.recipes);

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const html = injectRecipeData(template, recipeData);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, html, 'utf8');

  console.log(`Selesai. Situs statis ditulis ke: ${OUTPUT_PATH}`);
}

/**
 * Ubah array resep dari Sheets (bahasa Indonesia doang) jadi object
 * keyed by id, dengan tiap teks dibungkus { id, en } supaya struktur
 * datanya tetap cocok sama kode template (yang punya toggle ID/EN).
 * English-nya untuk sementara didup dari teks Indonesia (belum ada
 * terjemahan asli) — begitu kolom *_en ditambahin di Sheets, tinggal
 * ganti bagian "dup(...)" di bawah jadi ambil dari kolom itu.
 */
function buildRecipeData(recipes) {
  const dup = (text) => ({ id: text || '', en: text || '' });
  const out = {};

  recipes.forEach((r) => {
    out[r.id] = {
      tag: dup(r.tag),
      title: dup(r.title),
      timeFull: dup(r.timeFull),
      levelKey: r.levelKey,
      readTime: dup(estimateReadTime(r)),
      updated: dup(`Diperbarui ${r.updated}`),
      ceritaBody: dup(r.ceritaBody),
      baseServings: r.baseServings,
      baseCost: r.baseCost,
      ingredients: r.ingredients.map((ing) => ({
        base: ing.base,
        unit: ing.unit,
        name: dup(ing.name)
      })),
      steps: r.steps.map((s) => ({
        text: dup(s.text),
        timerSec: s.timerSec
      })),
      honestBody: dup(r.honestBody)
    };
  });

  return out;
}

function estimateReadTime(recipe) {
  const words = (recipe.ceritaBody || '').split(/\s+/).length
    + recipe.steps.reduce((sum, s) => sum + (s.text || '').split(/\s+/).length, 0);
  const minutes = Math.max(3, Math.round(words / 130));
  return `${minutes} menit baca`;
}

function injectRecipeData(template, recipeDataObj) {
  const startIdx = template.indexOf(START_MARKER);
  const endIdx = template.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error('Penanda BUILD:RECIPE_DATA tidak ditemukan di template — cek lagi templates/index.html');
  }

  const before = template.slice(0, startIdx);
  const after = template.slice(endIdx + END_MARKER.length);

  const injected = `${START_MARKER}\n  const recipeData = ${JSON.stringify(recipeDataObj, null, 2)};\n  ${END_MARKER}`;

  return before + injected + after;
}

main().catch((err) => {
  console.error('Build gagal:', err);
  process.exit(1);
});
