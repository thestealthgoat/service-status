// Rewrites the page's inline script for older phone browsers (old Android Chrome / Samsung Internet / WebViews
// before 2020 don't understand ?. and ??). Usage: node tools/compat.js in.html out.html  (needs esbuild)
const fs = require('fs'), esbuild = require(process.env.ESBUILD || 'esbuild');
const [src, out] = process.argv.slice(2);
let html = fs.readFileSync(src, 'utf8');
html = html.replace(/<script>([\s\S]*?)<\/script>/g, (m, code) =>
  '<script>' + esbuild.transformSync(code, { target: ['chrome61', 'safari12', 'firefox60'], loader: 'js' }).code + '</script>');
fs.writeFileSync(out, html);
