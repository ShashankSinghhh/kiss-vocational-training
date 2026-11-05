// Builds docs/postman/kiss-vtmp.postman_collection.json from apps/api/openapi.yaml, then makes
// it ready to use: baseUrl points at the local API and "Sign in" stores the access token in
// {{bearerToken}}, which every other request sends.
//   node scripts/postman.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const out = join(root, 'docs', 'internal', 'postman', 'kiss-vtmp.postman_collection.json');

execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    '-y',
    'openapi-to-postmanv2@4.25.0',
    '-s',
    join(root, 'apps', 'api', 'openapi.yaml'),
    '-o',
    out,
    '-O',
    'folderStrategy=Tags,requestParametersResolution=Example',
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

const collection = JSON.parse(readFileSync(out, 'utf8'));
const base = { key: 'baseUrl', value: 'http://localhost:4000/api/v1', type: 'string' };
collection.variable = [
  base,
  { key: 'bearerToken', value: '', type: 'string' },
  ...(collection.variable ?? []).filter((v) => !['baseUrl', 'bearerToken'].includes(v.key)),
];
collection.info.description =
  'Generated from apps/api/openapi.yaml (node scripts/postman.mjs). Run "Sign in" first: it ' +
  'stores the access token in {{bearerToken}}. Seed accounts are in the README.';

function walk(items) {
  for (const item of items) {
    if (item.item) walk(item.item);
    const url = item.request?.url;
    const path = Array.isArray(url?.path) ? url.path.join('/') : '';
    if (item.request?.method === 'POST' && path === 'auth/login') {
      item.request.body = {
        mode: 'raw',
        raw: JSON.stringify({ email: 'admin@kiss-vtmp.test', password: 'Password@123' }, null, 2),
        options: { raw: { language: 'json' } },
      };
      item.event = [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              'const token = pm.response.json().accessToken;',
              "if (token) pm.collectionVariables.set('bearerToken', token);",
            ],
          },
        },
      ];
    }
  }
}
walk(collection.item);
writeFileSync(out, `${JSON.stringify(collection, null, 2)}\n`);
console.log(`wrote ${out}`);
