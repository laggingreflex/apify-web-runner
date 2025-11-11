// CLI implementation using shared workflow & core logic.
// Try to use project's ../utils prompt, otherwise fallback to readline.
let prompt;
try {
  const u = require('../utils');
  prompt = u && u.enquire && u.enquire.prompt;
} catch (_) {
  prompt = null;
}
if (!prompt) {
  const readline = require('readline');
  prompt = function (q, defVal) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const pref = defVal !== undefined && defVal !== null && defVal !== '' ? ` (${defVal})` : '';
    return new Promise(res => {
      rl.question(`${q}${pref}: `, ans => {
        rl.close();
        res(ans && ans.length ? ans : defVal);
      });
    });
  };
}

const { runWorkflow } = require('./workflow');

module.exports = main;

async function main(argv) {
  // Adapter implementing uiAdapter contract for workflow.js
  const uiAdapter = {
    async getConnectionInfo(initial) {
      const token = await prompt('Apify API Token:', argv.token || initial.token || process.env.APIFY_TOKEN || '');
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
      const ans = await prompt(`${msg} (y/N)`, 'n');
      return /^y(es)?$/i.test(ans.trim());
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
