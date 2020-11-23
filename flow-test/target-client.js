const clientId = 'target';
const socketClient = require('socket.io-client');
const p2pClientPlugin = require('@gigasource/socket.io-p2p-plugin').p2pClientPlugin;

const rawSocket = socketClient.connect(`http://localhost:9000?clientId=${clientId}`);
const socket = p2pClientPlugin(rawSocket, clientId);

// onAny is used to listen to events from any clients
socket.on('test-event', targetClientId => console.log(`Received message from client ${targetClientId}`));
socket.once('test-event', () => console.log('This should happen only once'));

const {hooks, flow, execChain, getRestChain} = require('../flow/flow');
const _ = require('lodash');

hooks.post('flow-interface', async function ({args: [to], query}, returnResult) {
  if (to[0] === ':') socket.emitTo(to.slice(1), 'flow-interface', query);
})

socket.on('flow-interface', async function (query) {
  await execChain(query);
})

