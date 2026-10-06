#!/usr/bin/env node
// Run with backend or blockchain dependencies, including inside their image.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Wallet } = require(require.resolve('ethers', { paths: [
  path.resolve(__dirname, '../backend'), path.resolve(__dirname, '../blockchain'), process.cwd(),
] }));

const [host, email] = process.argv.slice(2);
if (!host || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host)
    || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: node scripts/generate-server-env.cjs <public-hostname> <administrator-email>');
  process.exit(1);
}
process.umask(0o077);
const root = path.resolve(__dirname, '..');
const envFile = path.join(root, 'deploy/.env.server');
const accessDir = path.join(root, '.server-deploy');
const accessFile = path.join(accessDir, 'access.json');
if (fs.existsSync(envFile) || fs.existsSync(accessFile)) {
  console.error('Existing deployment credentials found; refusing to rotate persistent chain or database secrets.');
  process.exit(1);
}
const wallet = Wallet.createRandom();
const values = { PUBLIC_HOST: host.toLowerCase() };
for (const key of ['POSTGRES_PASSWORD', 'JWT_ACCESS_TOKEN_SECRET', 'JWT_REFRESH_TOKEN_SECRET',
  'CSRF_TOKEN_SECRET', 'EMAIL_VERIFICATION_TOKEN_SECRET', 'PASSWORD_SETUP_TOKEN_SECRET']) {
  values[key] = crypto.randomBytes(32).toString('hex');
}
values.LOCAL_CHAIN_MNEMONIC = wallet.mnemonic.phrase;
values.CERTIFICATE_PRIVATE_KEY = wallet.privateKey;
values.MAIL_FROM_USER = 'noreply@localhost.invalid';
values.RESEND_API_KEY = '';
fs.mkdirSync(accessDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(envFile, Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
fs.writeFileSync(accessFile, JSON.stringify({
  url: `https://${host.toLowerCase()}`,
  email: email.toLowerCase(),
  password: crypto.randomBytes(24).toString('base64url'),
  name: 'School Demo Administrator',
}, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log('Created deploy/.env.server and .server-deploy/access.json with private file permissions.');
