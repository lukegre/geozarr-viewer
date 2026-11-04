// Helper for the node tests: run core/component source files in one vm context (as the page's single module scope
// does, minus the imports) and look top-level names up afterwards, the way the reference's tests/preview_*.cjs do.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function load(files, extras = {}) {
  const ctx = vm.createContext({console, URL, URLSearchParams, Float64Array, ...extras});
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, {filename: f});
  const get = (name) => vm.runInContext(name, ctx);
  get.ctx = ctx;
  return get;
}

module.exports = {load, ROOT};
