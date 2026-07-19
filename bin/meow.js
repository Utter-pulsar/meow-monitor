#!/usr/bin/env node
const { sendCyberRequest } = require('../src/cyber-bridge');

function usage() {
  console.log('Usage:');
  console.log('  meow "<identity>" "your message here"');
  console.log('  meow clear');
  console.log('  meow help');
  console.log('  meow -h');
  console.log('');
  console.log('Examples of <identity>: claude, codex, hermes, openclaw, build-agent');
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    usage();
    process.exit(args.length ? 0 : 4);
  }

  let payload = null;
  if (args[0] === 'clear') {
    payload = { type: 'clear' };
  } else {
    const [identity, ...rest] = args;
    const message = rest.join(' ').trim();
    if (!identity || !message) {
      usage();
      process.exit(4);
    }
    payload = { type: 'message', identity, message };
  }

  try {
    const res = await sendCyberRequest(payload);
    if (!res || res.ok === false) {
      console.error((res && res.message) || 'The cyber rail did not respond.');
      process.exit(res && res.code === 'bad_args' ? 4 : 3);
    }
    console.log(res.message || 'ok');
    if (res.disposition === 'stored_hidden') process.exit(2);
    process.exit(0);
  } catch (e) {
    console.error('meow-monitor is not running, or the local cyber rail service is unavailable.');
    if (e && e.code) console.error(`(${e.code})`);
    process.exit(3);
  }
}

main();
