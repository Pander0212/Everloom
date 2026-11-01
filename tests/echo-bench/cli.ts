/** npm run bench:echo — prints the ECHO recall benchmark as Markdown (and JSON with --json). */
import { runBench, toMarkdown } from './run.js';

const sizes = process.argv.filter((a) => /^\d+$/.test(a)).map(Number);
const reports = runBench(sizes.length ? sizes : undefined);
console.log(process.argv.includes('--json') ? JSON.stringify(reports, null, 2) : toMarkdown(reports));
