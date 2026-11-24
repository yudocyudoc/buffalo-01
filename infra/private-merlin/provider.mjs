// Imported only by the private I origin and its sandboxed AgentWorker.
import config from '../../config.js';
import {ENDPOINT,MODEL_IDS,requireThat} from './protocol.mjs';

const model = process.env.BUFFALO_PRIVATE_MERLIN_MODEL;
requireThat(MODEL_IDS.includes(model),'UNSUPPORTED_PRIVATE_MODEL');
config.nativeAgentProviders.cloudflare = {
  displayName:'Workers AI', model, summaryModel:model, baseURL:new URL('/v1',ENDPOINT).href
};
// The private gateway admits the running container through a platform intercept.
// The agent receives only this SDK placeholder.
process.env.CLOUDFLARE_API_KEY = 'private-intercept-only';
