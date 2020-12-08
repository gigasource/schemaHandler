const orm = require("../../../orm");
const { ObjectID } = require("bson");
const { stringify } = require("../../../utils");
const _ = require("lodash");
let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model, schema;
const uuid = require("uuid").v1;
const TRANSPORT_LAYER_TAG = require("../../../plugins/tags")
  .TRANSPORT_LAYER_TAG;
const SocketMock = require("socket.io-mock");
const { fork } = require("child_process");
const socketClient = require("socket.io-client");

describe("commit-sync-complex", function() {
  let testModel;
  let recoveryModel;
  let commitModel;
  beforeAll(async () => {
    orm.connect({ uri: "mongodb://localhost:27017" }, "myproject");
    orm.registerCommitCollections({
      Test: ["Test"]
    });
    await orm.setMaster(true);
    orm.use(require("./testCommit"));
    testModel = orm.getCollection("Test");
    recoveryModel = orm.getCollection("Recovery");
    commitModel = orm.getCollection("Commit");
    await testModel.deleteMany().direct();
    await recoveryModel.deleteMany().direct();
    await commitModel.deleteMany().direct();
  });

  afterEach(async () => {
    await testModel.deleteMany().direct();
    await recoveryModel.deleteMany().direct();
    await commitModel.deleteMany().direct();
  });

  it("run with an injected commit", async done => {
    const result = await orm
      .getCollection("Test")
      .create({
        table: 10,
        items: [{ name: "cola", price: 10, quantity: 1 }]
      })
      .commit("tagA");
    expect(stringify(result)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "items": Array [
          Object {
            "name": "cola",
            "price": 10,
            "quantity": 1,
          },
        ],
        "table": 10,
      }
    `);
    setTimeout(async () => {
      const orders = await testModel.find();
      expect(stringify(orders)).toMatchInlineSnapshot(`
        Array [
          Object {
            "_id": "ObjectID",
            "items": Array [
              Object {
                "name": "cola",
                "price": 10,
                "quantity": 1,
              },
            ],
            "table": 10,
          },
        ]
      `);
      done();
    }, 500);
  });

  it("Client master test", async done => {
    await orm.setMaster(false);
    const cp = fork(`${__dirname}/testMaster.js`);
    setTimeout(async () => {
      const socket = socketClient.connect("http://localhost:9000");
      await orm.emit(`${TRANSPORT_LAYER_TAG}:registerMasterSocket`, socket);
      const result = await testModel
        .create({
          clientMasterTest: true
        })
        .commit("tagA");
      expect(stringify(result)).toMatchInlineSnapshot(`
        Object {
          "_id": "ObjectID",
          "clientMasterTest": true,
        }
      `);
      setTimeout(async () => {
        const data = await testModel.find({});
        expect(stringify(data)).toMatchInlineSnapshot(`
          Array [
            Object {
              "_id": "ObjectID",
              "clientMasterTest": true,
            },
          ]
        `);
        const commits = await orm.getCollection("Commit").find({});
        expect(commits.length).toMatchInlineSnapshot(`1`);
        expect(commits[0].id).toMatchInlineSnapshot(`1`);
        done();
      }, 1000);
    }, 1000);
  });

  it("multi db case", async done => {
    await orm.setMaster(false)
    const cp = fork(`${__dirname}/testMasterMultiDb.js`);
    const messages = [];
    cp.on("message", function(data) {
      messages.push(data);
    });
    setTimeout(async () => {
      const socket = socketClient.connect("http://localhost:9000");
      await orm.emit(`${TRANSPORT_LAYER_TAG}:registerMasterSocket`, socket);
      const result = await testModel
        .create({
          clientMasterTest: true
        })
        .commit("tagA");
      setTimeout(async () => {
        const data = await testModel.find({});
        expect(stringify(data)).toMatchInlineSnapshot(`
          Array [
            Object {
              "_id": "ObjectID",
              "clientMasterTest": true,
              "fake": true,
            },
          ]
        `);
        done();
      });
    }, 1000);
  });
});
