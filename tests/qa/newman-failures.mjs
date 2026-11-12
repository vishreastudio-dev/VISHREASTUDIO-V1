// Summarise failed assertions from a Newman JSON export: node tests/qa/newman-failures.mjs <file>
import fs from 'fs';

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).run;
const byId = new Map(run.executions.map((e) => [e.item.id, e]));
for (const f of run.failures) {
  const e = byId.get(f.source?.id) || run.executions.find((x) => x.item.name === f.source?.name);
  const code = e?.response?.code;
  let snippet = '';
  try {
    const bytes = e?.response?.stream?.data;
    if (bytes) snippet = Buffer.from(bytes).toString('utf8').slice(0, 160).replace(/\s+/g, ' ');
  } catch {}
  console.log(`- [${f.parent?.name || ''}] ${f.source?.name} | ${f.error?.test}: ${String(f.error?.message).slice(0, 140)} | HTTP ${code} ${snippet}`);
}
