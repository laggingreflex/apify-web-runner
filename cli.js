// CLI implementation using shared workflow & core logic (ESM style).
// Use enquire-simple at root level for consistent prompts.
import enquire from 'enquire-simple';
const { prompt, confirm, password } = enquire;

import { runWorkflow } from './src/lib/workflow.js';

export default main;

async function main(argv) {
  // Adapter implementing uiAdapter contract for workflow.js
  const uiAdapter = {
    async getConnectionInfo(initial) {
      // Prefer masked input for token if available
      const defaultToken = argv.token || initial.token || process.env.APIFY_TOKEN || '';
      const token = password ? await password('Apify API Token') : await prompt('Apify API Token:', defaultToken);
      const actorId = await prompt('Apify Actor:', argv.actor || initial.actorId || 'apify/hello-world');
      const outputKey = await prompt('Output Key:', argv.output || initial.outputKey || 'OUTPUT');
      return { token, actorId, outputKey };
    },
    async show(msg, data) {
      if (data !== undefined) {
        console.log(msg + ':');
        try {
          console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
        } catch (_) {
          console.log(data);
        }
      } else {
        console.log(msg);
      }
    },
    async confirm(msg) {
      const ans = await confirm(msg);
      return typeof ans === 'boolean' ? ans : /^y(es)?$/i.test(String(ans).trim());
    },
    async getInput(schemaProps, defaults, meta) {
      const input = {};
      const keys = schemaProps ? Object.keys(schemaProps) : Object.keys(defaults || {});
      for (const key of keys) {
        const prop = schemaProps ? schemaProps[key] : null;
        const defVal = defaults && defaults[key];
        let askDefault = argv[key] || defVal;
        let answer;
        if (typeof askDefault === 'object' && askDefault !== null && !Array.isArray(askDefault)) {
          answer = await prompt(`${key} (JSON)`, JSON.stringify(askDefault));
          try {
            answer = JSON.parse(answer);
          } catch (_) {
            // keep as string if invalid JSON
          }
        } else if (Array.isArray(askDefault)) {
          answer = await prompt(`${key} (comma separated)`, askDefault.join(','));
          answer = answer
            .split(',')
            .map(x => x.trim())
            .filter(Boolean);
        } else if (typeof askDefault === 'boolean') {
          answer = await prompt(`${key} (true/false)`, String(askDefault));
          answer = /true/i.test(answer.trim());
        } else if (askDefault !== undefined) {
          answer = await prompt(key, String(askDefault));
        } else {
          answer = await prompt(key, '');
        }
        if (answer !== '' && answer !== undefined) input[key] = answer;
      }
      return input;
    },
  };

  const result = await runWorkflow({ uiAdapter, initial: {} });

  if (result && result.run) {
    const { run, outputs } = result;
    if (outputs) {
      console.log('KV Record:', outputs.kvRecord ? JSON.stringify(outputs.kvRecord, null, 2) : 'None');
      console.log('Dataset Items:', outputs.datasetItems ? outputs.datasetItems.length : 0);
    }
  }
}

// Execute when run directly: `node cli.js`
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';
const isDirect = process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url));
if (isDirect) {
  // naive argv parse: support --token=, --actor=, --output=
  const argv = Object.fromEntries(process.argv.slice(2).map(arg => {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [arg.replace(/^--/, ''), true];
  }));
  main(argv).catch(err => {
    console.error(err?.stack || err);
    process.exitCode = 1;
  });
}
