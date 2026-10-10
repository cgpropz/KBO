// Vercel Hobby rejects a deployment with more than 12 Serverless Functions.
// Files in api/ whose names start with _ are helpers and are not deployed.
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HOBBY_FUNCTION_LIMIT = 12;

export function serverlessFunctionFiles(apiRoot) {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.js') && !name.startsWith('_')) found.push(path);
    }
  };
  walk(apiRoot);
  return found.sort();
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  const apiRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'api');
  const files = serverlessFunctionFiles(apiRoot);
  console.log(`Serverless functions: ${files.length} (Hobby limit ${HOBBY_FUNCTION_LIMIT})`);
  for (const file of files) console.log(`  ${file.slice(apiRoot.length + 1)}`);
  if (files.length > HOBBY_FUNCTION_LIMIT) {
    console.error(`Vercel Hobby allows at most ${HOBBY_FUNCTION_LIMIT} Serverless Functions.`);
    process.exit(1);
  }
}
