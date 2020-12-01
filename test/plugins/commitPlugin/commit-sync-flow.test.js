const {
  checkEqual2,
  convertSchemaToPaths,
  findAllPathsInLevelArrHandler2,
  parseCondition
} = require("../../../schemaHandler");
const orm = require("../../../orm");
const { ObjectID } = require("bson");
const { stringify } = require("../../../utils");
const _ = require("lodash");
let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model, schema;
const uuid = require("uuid").v1;

// run when orm.create()
describe("Commit flow basic", function() {
  beforeAll(async () => {
    orm.connect({ uri: "mongodb://localhost:27017" }, "myproject");
    schema = {
      table: String
    };
    orm.commitHandler.registerCommitCollections("Order");
    orm.commitHandler.registerCommitCollections("Pos", ["Room", "OrderLayout"]);
    orm.commitHandler.registerCommitCollections("Payment", [
      { name: "Payment", needMaster: true }
    ]);
    orm.commitHandler.startQueue();
  });

  it("check commitTypes array", () => {
    expect(orm.commitHandler.commitTypes).toMatchInlineSnapshot(`
      Object {
        "Order": Object {
          "groupName": "Order",
          "name": "Order",
          "needMaster": true,
        },
        "OrderLayout": Object {
          "groupName": "Pos",
          "name": "OrderLayout",
          "needMaster": true,
        },
        "Payment": Object {
          "name": "Payment",
          "needMaster": true,
        },
        "Room": Object {
          "groupName": "Pos",
          "name": "Room",
          "needMaster": true,
        },
      }
    `);
  });

  it("check warn when a collection is added twice", () => {
    console.warn = jest.fn();
    orm.commitHandler.registerCommitCollections("someType", ["Room"]);
    expect(console.warn.mock.calls.length).toMatchInlineSnapshot(`1`);
  });

  it("run non allowed method", async function() {});

  it("master flow single db", async function(done) {
    orm.commitHandler.setMaster(true);
    orm.on("commit:preHandleCommits", commits => {
      expect(commits.length).toMatchInlineSnapshot();
    });
    const commitHandlerFn = jest.fn(commit => {
      expect(typeof commit._id).toMatchInlineSnapshot(`"object"`);
      expect(commit._id.toString().length).toMatchInlineSnapshot(`24`);
      delete commit._id;
      expect(commit).toMatchInlineSnapshot(`
        Object {
          "collectionName": "Order",
          "data": Object {},
          "query": "{\\"name\\":\\"Order\\",\\"chain\\":[{\\"fn\\":\\"create\\",\\"args\\":[{\\"table\\":10,\\"items\\":[{\\"name\\":\\"cola\\",\\"price\\":10,\\"quantity\\":1}]}]}]}",
          "tags": Array [],
        }
      `);
      expect(orm.commitHandler.sync.mock.calls.length).toMatchInlineSnapshot(
        `0`
      );
      expect(commitHandlerFn.mock.calls.length).toMatchInlineSnapshot(`1`);
      done();
    });
    orm.on("commit:Order", commitHandlerFn);
    const orderModel = orm("Order");
    await orderModel.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    });
  });
});
