console.group();
const clientId = 'target';
const socketClient = require('socket.io-client');
const p2pServerPlugin = require('@gigasource/socket.io-p2p-plugin').p2pServerPlugin;
const p2pClientPlugin = require('@gigasource/socket.io-p2p-plugin').p2pClientPlugin;
const http = require('http');
const socketIO = require('socket.io');

let server;
async function initSocket() {
  const httpServer = http.createServer((req, res) => res.end()).listen(9000);
  const io = socketIO(httpServer, {})
  server = p2pServerPlugin(io);
  io.on('connect', function () {
    console.log('connect')
  })
}
initSocket();

const rawSocket = socketClient.connect(`http://localhost:9000?clientId=${clientId}`);
const socket = p2pClientPlugin(rawSocket, clientId);

// onAny is used to listen to events from any clients
socket.on('test-event', targetClientId => console.log(`Received message from client ${targetClientId}`));
socket.once('test-event', () => console.log('This should happen only once'));

process.env.ENV = 'target';

const {hooks, flow, execChain, getRestChain} = require('../flow/flow');
const _ = require('lodash');
const fs = require("fs");

hooks.post('flow-interface', async function ({args: [to], query}, returnResult) {
  if (to[0] === ':') socket.emitTo(to.slice(1), 'flow-interface', query);
})

flow.require(socket, {name: 'socket'}).then();
flow.require(fs, {name: 'fs'}).then();

socket.on('flow-interface', async function (query) {
  query.target = true;
  await execChain(query);
})

