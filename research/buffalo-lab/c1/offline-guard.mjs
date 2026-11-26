// Research-only preload: constructors need a nonempty SDK credential even
// when createChatCompletion is replaced. Never use a real provider secret.
// Deny network access in the test process, independently of the mock.
import net from 'node:net';
import tls from 'node:tls';
process.env.GEMINI_API_KEY='offline-placeholder-not-a-real-key';
process.env.GOOGLE_API_KEY='offline-placeholder-not-a-real-key';
const deny=()=>{throw Error('C1_OFFLINE_NETWORK_DENIED')};
globalThis.fetch=deny;
net.Socket.prototype.connect=deny;
tls.connect=deny;
