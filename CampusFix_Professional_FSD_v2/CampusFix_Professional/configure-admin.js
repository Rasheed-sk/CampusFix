'use strict';

const readline = require('node:readline');
const crypto = require('node:crypto');
const { createApplication } = require('./server');

function promptHidden(message) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function' || !process.stdout.isTTY) {
    return Promise.reject(new Error('Run this command in an interactive terminal so the password can be entered without echo.'));
  }

  readline.emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  process.stdout.write(message);

  return new Promise((resolve, reject) => {
    let value = '';
    function finish(error) {
      input.removeListener('keypress', onKeypress);
      input.setRawMode(wasRaw);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    }
    function onKeypress(character, key = {}) {
      if (key.ctrl && key.name === 'c') {
        finish(new Error('Administrator setup cancelled.'));
      } else if (key.name === 'return' || key.name === 'enter') {
        finish();
      } else if (key.name === 'backspace') {
        value = Array.from(value).slice(0, -1).join('');
      } else if (character && !key.ctrl && !key.meta) {
        value += character;
      }
    }
    input.on('keypress', onKeypress);
  });
}

async function main() {
  const generate = process.argv.includes('--generate');
  const email = process.argv.slice(2).find(argument => !argument.startsWith('--')) || process.env.ADMIN_EMAIL;
  if (!email) throw new Error('Provide the admin email: npm run admin:setup -- name@gmail.com');

  const password = generate ? crypto.randomBytes(24).toString('base64url') : await (async () => {
    process.stdout.write('Admin password (12+ characters; input hidden): ');
    const entered = await promptHidden('');
    process.stdout.write('Confirm password (input hidden): ');
    const confirmation = await promptHidden('');
    if (entered !== confirmation) throw new Error('Passwords do not match.');
    return entered;
  })();

  const application = createApplication();
  try {
    const admin = await application.configureAdminCredentials({
      email,
      password,
      name: process.env.ADMIN_NAME || 'Campus Admin'
    });
    process.stdout.write(`Administrator credentials updated for ${admin.email}.\n`);
    if (generate) process.stdout.write(`Generated password (save it now): ${password}\n`);
  } finally {
    await application.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
