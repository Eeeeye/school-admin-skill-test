// Ganache ships pre-bundled crypto dependencies which lockfile-only audits do
// not see. Replace those copies with explicit, locked, same-major packages.
// This changes no Ganache source, EVM rules, chain database or contract code.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const projectRequire = createRequire(path.join(__dirname, '..', 'package.json'));
const replacements = { 'secp256k1': '4.0.5', 'elliptic': '6.6.1', 'bn.js': '4.12.3' };

function packageInfo(requireFrom, name) {
  const file = requireFrom.resolve(`${name}/package.json`);
  return { directory: path.dirname(fs.realpathSync(file)), version: JSON.parse(fs.readFileSync(file, 'utf8')).version };
}

function harden({ checkOnly = false } = {}) {
  const ganache = packageInfo(projectRequire, 'ganache');
  if (ganache.version !== '7.9.2') throw new Error('Review the bundled-dependency hardening before changing the Ganache version');
  const bundledDirectory = path.join(ganache.directory, 'node_modules');
  const ganacheRequire = createRequire(path.join(ganache.directory, 'package.json'));
  for (const [name, expected] of Object.entries(replacements)) {
    const replacement = packageInfo(projectRequire, name);
    if (replacement.version !== expected) throw new Error(`Unexpected locked ${name} version`);
    const destination = path.join(bundledDirectory, name);
    if (!checkOnly) {
      // Remove only the three named package copies in this installed Ganache
      // directory. Relative links remain valid when Docker copies node_modules.
      let alreadyLinked = false;
      try { alreadyLinked = fs.lstatSync(destination).isSymbolicLink() && fs.realpathSync(destination) === replacement.directory; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!alreadyLinked) {
        fs.rmSync(destination, { recursive: true, force: true });
        fs.mkdirSync(bundledDirectory, { recursive: true });
        fs.symlinkSync(path.relative(bundledDirectory, replacement.directory), destination, 'dir');
      }
    }
    const effective = packageInfo(ganacheRequire, name);
    if (effective.version !== expected || effective.directory !== replacement.directory) {
      throw new Error(`Ganache resolves an unhardened ${name} dependency; run pnpm harden:runtime`);
    }
  }
  return { ganache: ganache.version, ...replacements };
}

if (require.main === module) {
  try {
    const versions = harden({ checkOnly: process.argv.includes('--check') });
    console.log(`Ganache runtime dependencies verified: ${JSON.stringify(versions)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { harden };
