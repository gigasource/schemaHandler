const {reactive, computed, watch, watchEffect, h, toRaw} = require('vue');
const orm = require("../orm");
const {ObjectID} = require("bson");
const {hooks, flow, getRestChain, execChain} = require('../flow/flow');
const http = require('http');
const socketIO = require('socket.io');
const p2pServerPlugin = require('@gigasource/socket.io-p2p-plugin').p2pServerPlugin;
const socketClient = require('socket.io-client');
const p2pClientPlugin = require('@gigasource/socket.io-p2p-plugin').p2pClientPlugin;
const _ = require('lodash');
const fs = require('fs');
const {fork} = require('child_process');
let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model;
let server, clientSocket;


async function run() {
  const {initOrderLogic} = require('./pos-logic');
  await initOrderLogic()
  hooks.post('flow-interface', async function ({args: [to], query}, returnResult) {
    if (to[0] === ':') clientSocket.emitTo(to.slice(1), 'flow-interface', query);
  })

  hooks.post(':print', async function ({fn, args, index, chain, scope}, returnResult) {
    console.log('print', scope);
  })

  hooks.post(':log', async function ({fn, args, index, chain, scope}, returnResult) {
    console.log(scope);
  })

  await flow.require(orm, {
    name: 'orm',
    chainable: true,
  });
}

async function initSocket() {
  const httpServer = http.createServer((req, res) => res.end()).listen(9000);
  const io = socketIO(httpServer, {})
  server = p2pServerPlugin(io);
  io.on('connect', function () {
    console.log('connect')
  })
}

async function initClient() {
  const clientId = 'source';

  const rawSocket = socketClient.connect(`http://localhost:9000?clientId=${clientId}`);
  clientSocket = p2pClientPlugin(rawSocket, clientId);
  //duplex1 = await socket.addP2pStream('target', {});
}

const {
  Worker, isMainThread, parentPort, workerData
} = require('worker_threads')

const _beforeAll = global.beforeAll || before;

_beforeAll(async () => {
  orm.connect({uri: "mongodb://localhost:27017"}, "myproject");
  const schema = {
    a: Number,
    b: {
      type: Number,
      default: 100
    },
    items: [{}],
    date: Date,
    strArr: [String],
    groups: [
      {
        type: ObjectID
      }
    ],
    author: {
      type: ObjectID
    },
    categories: [
      {
        name: String,
        products: [
          {
            name: String,
            items: [{}]
          }
        ]
      }
    ]
  };
  //paths = convertSchemaToPaths(schema);
  Model = orm.registerSchema("Model", schema);
  await Model.remove();
  model = await Model.create({
    categories: [
      {
        name: "catA",
        products: [{name: "A"}, {name: "B"}]
      },
      {
        name: "catB",
        products: [{name: "C"}, {name: "D"}]
      }
    ]
  });
  await run();
  //await initSocket();
  await initClient();
  clientSocket.on('flow-interface', async function (query) {
    await execChain(query);
  })

  //const worker = new Worker(`${__dirname}/target-client.js`);
  //require('./target-client')
  fork(`${__dirname}/target-client.js`);

  flow.require(clientSocket, {name: 'socket'}).then();
  flow.require(fs, {name: 'fs'}).then();

  await new Promise((resolve, reject) => {
    setTimeout(() => {
      clientSocket.emitTo('target', 'test-event', '1234');
      resolve();
    }, 100)
  })

  console.log('before finish')
});

describe("test flow 1", function () {
  it("case1", async function () {
    await flow.shorthand(':createOrder').create('@').end();
    const foodTax = {taxes: [5, 10]};
    const drinkTax = {taxes: [16, 32]};

    let order = await flow.timeout(10).login('0000').openTable('10')
      .addItem({name: 'Cola', price: 1.3, quantity: 10, tax: 5, ...drinkTax})
      .addItem({name: 'Fanta', price: 2, quantity: 20, ...drinkTax})
      .addItem({name: 'Rice', price: 10, quantity: 1, ...foodTax})
      .addModifiers({name: 'Add Ketchup', price: 3, quantity: 1})
      .takeAway()
      //.changeQuantity()
      .discount('33.33%')
      .toBE()
      .orm('Order').create('@').end()
      .logOrder().v()

    order = toRaw(order);
    await flow.orm('Order').count({}).end().log();
  });

  it('test sandbox code', async function () {
    let a = 10;
    const cb = () => {
      a = 11;
    }
    console.log('done !');
    console.log('b')
  })

  it('test io', async function (done) {
    await flow.to({clientId: 'target'}).test('').to({clientId: 'source'}).test();
    setTimeout(done, 100)
  })

  it('register stream on io 2', () => new Promise(async (resolve, reject) => {
    console.log('abc')
    hooks.post(':done', async function ({fn, args, index, chain, scope, query}, returnResult) {
      //resolve();
    })

    //way 3: shorthand : concept multi flow in one
    //problem: hard to read the order of steps
    //difficult for debugging
    //flow sẽ có 2 cơ chế : cursor và callback ->
    //pre-process -> make callback, stash parent scope
    //.return() to up from callback :
    //~ flow.on('A').doA1().doA2().return().doB()
    //is equal to: _flow = await flow.on('A', async () => await doA1();await doA2()); await _flow.doB()
    //f0.on->f1->return ->f0->
    //@next: next will make the next cursor to result before execute function pipe

    //use case: know when it is finished;
    await flow
      .to(`:target`)
      .socket().onAddP2pStream('channel1', '@callback').pipe('@next').end()
      .fs().createWriteStream(__dirname + '/output.txt').end()
      .use('@last[1]').on('close', '@callback').end().test().to(':source').done().return()
      .return()
      .to(':source')
      .socket().addP2pStream('target', 'channel1').end()
      .fs().createReadStream(__dirname + '/input.txt').pipe('@last').end()
      .use('@last').on('close', '@callback').destroy().end().return()


    //vấn đề là ngay cả khi dùng flow như này thì cũng ko thể nào bỏ cách code truyền thống đc ???
    //nếu cái on chưa tồn tại  thì queue đợi cho đến khi on của sự kiện đó tồn tại !!!
    //như vậy sẽ ko cần phải để ý đến timing nhiều
    //setTimeout(done, 500)

  }))

  it('case 2', async function (done) {

  })

  it("update file", async function () {
    //await flow.to({domain: 'online-order'}).registerDialog('placeId', <dialog></dialog>);

    await flow
      .buildpkg().zipfile().makeMd5()
      .checkExistsVersion()
      .to({domain: 'online-order'})
      .io().on('stream').end()
      .to('begin')
      .emitBinaryTo({domain: 'online-order'})
      .showNotification('upload finished')
      .to({domain: 'online-order'})
      .showNotification()
  });
});
