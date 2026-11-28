import { strictCacheEnabled, cacheLease, cacheModelHash, explicitRun, invalidateCacheSlot, recordCache } from './c1ParityCache.js';
import { z } from 'zod';
import { createFeedbackRequestMessage } from '../../utilities/MessageProtocol.js';
import { generateRequestId, createSuccessResponse, createErrorResponse } from './toolHelpers.js';

/**
 * Request feedback loop analysis data from the client
 */
export function createGetFeedbackInformationTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Request feedback loop analysis data from the client and cache it for use by other tools. MUST be called before using discuss_model_with_seldon or generate_ltm_narrative. Provide a list of run IDs to get feedback for.',
    supportedModes: ['sfd', 'cld'],
    inputSchema: z.object({
      runIds: z.array(z.string()).describe('List of simulation run IDs to get feedback for')
    }),
    handler: async ({ runIds }) => {
      let release;
      try {
        // Create a promise that will be resolved when client responds
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        const strict = strictCacheEnabled();
        let runId, modelHash;
        if (strict) {
          release = cacheLease(session);
          runId = explicitRun(runIds);
          modelHash = cacheModelHash(sessionManager, sessionId);
          invalidateCacheSlot(session, 'feedback');
        }
        const requestId = generateRequestId('feedback');

        // Send request to client for feedback data
        await sendToClient(createFeedbackRequestMessage(sessionId, requestId, runIds));

        // Create pending request that will be resolved when client responds
        const resultPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Feedback request timeout: Client did not respond within 30 seconds'));
          }, 30000);

          // Store the resolver in session so it can be called when client responds
          if (!session.pendingFeedbackRequests) {
            session.pendingFeedbackRequests = new Map();
          }
          session.pendingFeedbackRequests.set(requestId, { resolve, reject, timeout });
        });

        const feedbackData = await resultPromise;

        const cacheData = { feedbackContent: feedbackData.feedbackContent, runIds: feedbackData.runIds };
        const { filePath } = sessionManager.writeDataToDisk(sessionId, 'feedback.json', cacheData);
        if (strict) recordCache(sessionManager, sessionId, session, 'feedback', runId, modelHash, 'feedback.json', cacheData);

        return createSuccessResponse({
          message: 'Feedback information cached. Other tools will load it automatically — you do not need to read this file.',
          filePath,
          runIds: feedbackData.runIds
        });
      } catch (error) {
        return createErrorResponse(`Failed to get feedback information: ${error.message}`, error);
      } finally { release?.(); }
    }
  };
}
