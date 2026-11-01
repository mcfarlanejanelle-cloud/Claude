#!/usr/bin/env node
/*
 * Bundles index.html + css + js into one self-contained page body
 * (no <html>/<head>/<body> wrapper) for publishing as a claude.ai Artifact.
 * usage: node tools/build-artifact.js [out-file]
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = process.argv[2] || path.join(root, 'dist', 'lumen-studio.html');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const metas = (html.match(/<meta name="claude:[^>]*>/g) || []).join('\n');
const fontLinks = (html.match(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts[^>]*>/g) || []).join('\n');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

let body = html.match(/<body>([\s\S]*)<\/body>/)[1];
body = body.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  const code = fs.readFileSync(path.join(root, src), 'utf8');
  return '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';
});

const page = [title, metas, fontLinks, '<style>\n' + css + '\n</style>', body.trim()].join('\n');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log('wrote', path.relative(process.cwd(), out), (page.length / 1024).toFixed(0) + ' KB');
