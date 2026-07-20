#!/usr/bin/env node
const { sendCyberRequest } = require('../src/cyber-bridge');

function usage(output = console.log) {
  output('Usage:');
  output('  meow "<identity>" "your message here"');
  output('  meow clear');
  output('  meow help');
  output('  meow -h');
  output('');
  output('Examples of <identity>: claude, codex, hermes, openclaw, build-agent');
}

async function runCli(args, output = console) {
  if (!args.length || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    usage((line) => output.log(line));
    return args.length ? 0 : 4;
  }

  let payload = null;
  if (args[0] === 'clear') {
    payload = { type: 'clear' };
  } else {
    const [identity, ...rest] = args;
    const message = rest.join(' ').trim();
    if (!identity || !message) {
      usage((line) => output.log(line));
      return 4;
    }
    payload = { type: 'message', identity, message };
  }

  try {
    const res = await sendCyberRequest(payload);
    if (!res || res.ok === false) {
      console.error((res && res.message) || 'The cyber rail did not respond.');
      return res && res.code === 'bad_args' ? 4 : 3;
    }
    console.log(res.message || 'ok');
    if (res.disposition === 'stored_hidden') return 2;
    return 0;
  } catch (e) {
    console.error('meow-monitor is not running, or the local cyber rail service is unavailable.');
    if (e && e.code) console.error(`(${e.code})`);
    return 3;
  }
}

if (require.main === module) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}

module.exports = { runCli, usage };
