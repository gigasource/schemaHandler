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
const SocketMock = require("socket.io-mock");
const jsonFn = require("json-fn");

const { TRANSPORT_LAYER_TAG } = require("../../../plugins/tags");

// run when orm.create()
describe("Commit flow basic", function() {
  let commitTypes;
  beforeAll(async () => {
    orm.connect({ uri: "mongodb://localhost:27017" }, "myproject");
    schema = {
      table: String
    };
    commitTypes = orm.registerCommitCollections({
      Order: ["Order"],
      Pos: ["Room", "OrderLayout"],
      Payment: [{ name: "Payment" }]
    });
    // orm.registerCommitCollections("Order");
    // orm.commitHandler.registerCommitCollections("Pos", ["Room", "OrderLayout"]);
    // orm.commitHandler.registerCommitCollections("Payment", [
    //   { name: "Payment", needMaster: true }
    // ]);
    // orm.commitHandler.startQueue();
  });

  it("check commitTypes array", () => {
    expect(commitTypes).toMatchInlineSnapshot(`
      Object {
        "Order": Object {
          "commitType": "Order",
          "name": "Order",
        },
        "OrderLayout": Object {
          "commitType": "Pos",
          "name": "OrderLayout",
        },
        "Room": Object {
          "commitType": "Pos",
          "name": "Room",
        },
      }
    `);
  });

  it("run non allowed method", async function() {});

  it("master flow single db", async function(done) {
    await orm.setMaster(true);
    orm.on("commit:preHandleCommits", commits => {
      expect(commits.length).toMatchInlineSnapshot();
    });
    const commitHandlerFn = jest.fn(commit => {
      expect(commitHandlerFn.mock.calls.length).toMatchInlineSnapshot(`1`);
      done();
      orm.off("commit:Order", commitHandlerFn);
    });
    orm.on("commit:Order", commitHandlerFn);
    const orderModel = orm("Order");
    await orderModel.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    });
  });

  it("client flow single db", async function(done) {
    await orm.setMaster(false);
    const socket = new SocketMock();
    socket.on("sync", commits => {
      socket.emit("sync", commits);
    });
    await orm.emit(
      `${TRANSPORT_LAYER_TAG}:registerMasterSocket`,
      socket.socketClient
    );

    const commitHandlerFn = jest.fn(commit => {
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

  // todo move this to transporter test
  it("socket disconnected", async function(done) {
    await orm.setMaster(false);
    const socket = new SocketMock();
    await orm.emit(
      `${TRANSPORT_LAYER_TAG}:registerMasterSocket`,
      socket.socketClient
    );
    const preHookArrayLength = !Array.isArray(
      orm._events[`${TRANSPORT_LAYER_TAG}:emitToMaster`]
    )
      ? orm._events[`${TRANSPORT_LAYER_TAG}:emitToMaster`]
        ? 1
        : 0
      : orm._events[`${TRANSPORT_LAYER_TAG}:emitToMaster`].length;
    socket.disconnect();
    const afterHookArrayLength = !Array.isArray(
      orm._events[`${TRANSPORT_LAYER_TAG}:emitToMaster`]
    )
      ? orm._events[`${TRANSPORT_LAYER_TAG}:emitToMaster`]
        ? 1
        : 0
      : orm._events[`${TRANSPORT_LAYER_TAG}:emitToMaster`].length;
    expect(afterHookArrayLength).toBe(preHookArrayLength - 1);
    done();
  });
});
