// Generates (and caches) a self-signed dev cert whose SANs cover localhost
// plus every non-internal IPv4 on this machine, as proper iPAddress entries.
//
// The @vitejs/plugin-basic-ssl cert only SANs localhost/127.0.0.1, and its
// `domains` option emits DNS SANs, which browsers will NOT match against an
// IP-literal hostname - so LAN devices get a hard ERR_CERT_COMMON_NAME_INVALID
// with no "proceed anyway" option. Browsers require the LAN IP as an IP SAN.
//
// Regenerates only when the SAN set changes (fingerprint file).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, '.devcert');
const keyPath = resolve(dir, 'key.pem');
const certPath = resolve(dir, 'cert.pem');
const fingerprintPath = resolve(dir, 'fingerprint');

const lanIps = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address)
  .sort();

const san = ['DNS.1 = localhost', 'IP.1 = 127.0.0.1', 'IP.2 = ::1', ...lanIps.map((ip, i) => `IP.${i + 3} = ${ip}`)];
const fingerprint = createHash('sha256').update(san.join('\n')).digest('hex');

function configFile() {
  const cnf = [
    '[req]',
    'distinguished_name = dn',
    'x509_extensions = v3',
    'prompt = no',
    '[dn]',
    'CN = localhost',
    '[v3]',
    'subjectAltName = @alt',
    '[alt]',
    ...san,
  ].join('\n');
  const path = resolve(dir, 'openssl.cnf');
  writeFileSync(path, cnf);
  return path;
}

export function devCert() {
  mkdirSync(dir, { recursive: true });
  if (
    existsSync(certPath) &&
    existsSync(keyPath) &&
    existsSync(fingerprintPath) &&
    readFileSync(fingerprintPath, 'utf8') === fingerprint
  ) {
    return { key: keyPath, cert: certPath };
  }
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath,
    '-days', '365', '-config', configFile(),
  ], { stdio: 'ignore' });
  writeFileSync(fingerprintPath, fingerprint);
  console.log(`[dev-cert] regenerated cert with SANs: ${san.join(', ')}`);
  return { key: keyPath, cert: certPath };
}
