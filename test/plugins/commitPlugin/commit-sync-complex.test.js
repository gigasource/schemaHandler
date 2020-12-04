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

describe("commit-sync-complex", function() {
  let testModel;
  let testRecoveryModel;
  beforeAll(async () => {
    orm.connect({ uri: "mongodb://localhost:27017" }, "myproject");
    orm.registerCommitCollections({
      Test: ["Test"]
    });
    orm.setMaster(true);
    testModel = orm.getCollection("Test");
    testRecoveryModel = orm.getCollection("Test-recovery");
    await testModel.deleteMany().direct();
    await testRecoveryModel.deleteMany().direct();
  });

  afterEach(async () => {
    await testModel.deleteMany().direct();
    await testRecoveryModel.deleteMany().direct();
  });

  it("run with an injected commit", async done => {
    orm.use(require("./testCommit"));
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

  it('Client master')
});
