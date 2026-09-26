const shorts = require('../server/shorts_remote');

const args = new Map(process.argv.slice(2).map(arg => {
  const [k, v = ''] = arg.replace(/^--/, '').split('=');
  return [k, v];
}));
const count = Number(args.get('count') || 500);
const category = String(args.get('category') || 'ALL').toUpperCase();

(async () => {
  const result = await shorts.grow({ count, category, maxRequests: Math.min(500, Math.ceil(count / 2) + 30) });
  console.log(JSON.stringify(result, null, 2));
})().catch(err => { console.error(err); process.exit(1); });
