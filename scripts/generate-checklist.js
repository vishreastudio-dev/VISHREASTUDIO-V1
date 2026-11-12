// Regenerates the body of docs/client/IMPLEMENTATION_CHECKLIST.md from docs/client/REQUIREMENTS_TRACEABILITY_MATRIX.md,
// so the checklist can never disagree with the matrix. Usage: node scripts/generate-checklist.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rtm = fs.readFileSync(path.join(root, 'docs/client/REQUIREMENTS_TRACEABILITY_MATRIX.md'), 'utf8').split(/\r?\n/);
const checklistPath = path.join(root, 'docs/client/IMPLEMENTATION_CHECKLIST.md');
const start = rtm.findIndex((l) => l.startsWith('## 1. Customers'));
const end = rtm.findIndex((l) => l.startsWith('## 13. Acceptance'));
const atEnd = rtm.findIndex((l) => l.startsWith('## 14.'));
const split = (l) => l.split(/(?<!\\)\|/).map((c) => c.trim());
const rows = rtm.slice(start, end).filter((l) => /^\| [A-Z]/.test(l) && !l.startsWith('| Requirement ID')).map((l) => {
  const c = split(l);
  return { id: c[1].replace(/\s*\*\(derived[^)]*\)\*/, ''), name: c[2], status: c[7], remaining: c[8] };
});
const groups = [
  ['Membership', (id) => /^MEM-0[1-9]$|^MEM-1[2-6]$|^ACC-/.test(id) && !['MEM-05', 'MEM-06', 'MEM-15'].includes(id)],
  ['Payments and invoicing', (id) => /^PAY-|^INV-/.test(id)],
  ['Catalogue, customers and AI', (id) => /^CAT-|^CUS-|^AI-|^BO-01$/.test(id)],
  ['Shopping journey and checkout', (id) => /^SHP-0\d$|^LF-/.test(id)],
  ['Rewards and loyalty', (id) => /^MEM-10$|^LOY-(BLD|P1|P2|P5|P6|01|02)$|^REV-/.test(id)],
  ['Referrals', (id) => /^LOY-(P3|P4|03)$/.test(id)],
  ['Shipping and Wardrobe Bag', (id) => /^SHP-1\d$|^MEM-0[56]$|^MEM-15$/.test(id)],
  ['Orders, exchanges and returns', (id) => /^EXC-|^BO-0[35]$/.test(id)],
  ['Admin and back office', (id) => /^BO-(0[246789]|1[01])$|^ADM-/.test(id)],
  ['Security, privacy and quality', (id) => /^NFR-|^SEC-/.test(id)],
  ['Integrations and omnichannel', (id) => /^NOT-|^OMN-/.test(id)],
];
const mark = (s) => (s === 'VERIFIED COMPLETE' ? '[x]' : /BLOCKED|PENDING/.test(s) ? '[!]' : '[ ]');
const used = new Set();
const na = [];
let body = '';
for (const [title, test] of groups) {
  const g = rows.filter((r) => test(r.id) && !used.has(r.id));
  g.forEach((r) => used.add(r.id));
  na.push(...g.filter((r) => r.status === 'NOT APPLICABLE'));
  body += `\n## ${title}\n\n`;
  for (const r of g.filter((x) => x.status !== 'NOT APPLICABLE')) {
    body += `- ${mark(r.status)} **${r.id}** ${r.name} — *${r.status}*${r.status === 'VERIFIED COMPLETE' || r.remaining === '—' ? '' : `. Remaining: ${r.remaining}`}\n`;
  }
}
const missing = rows.filter((r) => !used.has(r.id));
if (missing.length) throw new Error(`Unmapped requirement rows: ${missing.map((r) => r.id).join(', ')}`);
body += '\n## Acceptance tests for 1.0 (spec §14)\n\n';
for (const l of rtm.slice(end, atEnd).filter((x) => x.startsWith('| AT-'))) {
  const c = split(l);
  body += `- ${mark(c[4].replace(/ \(.*$/, ''))} **${c[1]}** ${c[2]} — *${c[4]}*\n`;
}
body += '\n## Not applicable to Release 1.0\n\n';
for (const r of na) body += `- **${r.id}** ${r.name} — ${r.remaining === '—' ? 'release 1.1/2.0 or contractual' : r.remaining}\n`;

const counts = { x: 0, open: 0, bang: 0 };
for (const r of rows.filter((x) => x.status !== 'NOT APPLICABLE')) {
  const m = mark(r.status);
  if (m === '[x]') counts.x += 1;
  else if (m === '[!]') counts.bang += 1;
  else counts.open += 1;
}
let header = fs.readFileSync(checklistPath, 'utf8').split(/\r?\n## Membership/)[0].trimEnd();
header = header.replace(/Summary \([^)]*\): .*$/m, `Summary (${rows.length} requirement rows): **${counts.x}** \`[x]\`, **${counts.open}** \`[ ]\`, **${counts.bang}** \`[!]\`, **${na.length}** not applicable to Release 1.0.`);
fs.writeFileSync(checklistPath, `${header}\n${body}`, 'utf8');
console.log({ rows: rows.length, ...counts, na: na.length });
