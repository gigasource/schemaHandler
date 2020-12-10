//<editor-fold desc="declaration">
const Orm = require("../orm");
let ormA = new Orm();
ormA.name = "A";
let ormB = new Orm();
let ormC = new Orm();
ormC.name = "C";
const orm = ormA;
const { ObjectID } = require("bson");
const { stringify } = require("../utils");
const _ = require("lodash");
let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model, schema;
const uuid = require("uuid").v1;
const { Socket, Io } = require("../io/io");
const masterIo = new Io();
masterIo.listen("local");
const s1 = new Socket();
const s2 = new Socket();
const Hooks = require("../hooks/hooks");
const hooks = new Hooks();

const Queue = require("queue");
const delay = require("delay");
const syncPlugin = require("./sync-plugin-multi");
let toMasterLockA, toMasterLockC;
const AwaitLock = require("await-lock").default;
//</editor-fold>

describe("commit-sync", function() {
  //<editor-fold desc="Description">
  beforeAll(async () => {
    ormA.connect({ uri: "mongodb://localhost:27017" }, "myproject");
    ormB.connect({ uri: "mongodb://localhost:27017" }, "myproject2");

    ormA.plugin(syncPlugin, "client");
    ormA.emit("initSyncForClient", s1);

    ormB.plugin(syncPlugin, "master");
    ormB.emit("initSyncForMaster", masterIo);



    s1.connect("local");
    s2.connect("local");

    Model = ormA("Model");
    await ormA("Model").remove({});
    await ormA("Commit").remove({});
    await ormA("Recovery").remove({});
    await ormB("Model").remove({});
    await ormB("Commit").remove({});

    let orms = [ormA, ormB];
    async function enableC() {
      ormC.connect({ uri: "mongodb://localhost:27017" }, "myproject3");

      await ormC("Model").remove({});
      await ormC("Commit").remove({});
      await ormC("Recovery").remove({});

      ormC.plugin(syncPlugin, "client");
      ormC.emit("initSyncForClient", s2);

      orms.push(ormC);
    }
    //await enableC();

    for (const orm of orms) {
      orm.registerCommitBaseCollection("Model");
      orm.on(`commit:auto-assign:Model`, (commit, _query, target) => {
        if (target.cmd === "create") {
          commit.data.table = _.get(_query, "chain[0].args[0].table");
          commit.tags.push("create");
        }
      });

      orm.onQueue("process:commit", async function(commit) {
        const { chain } = orm.getQuery(commit);
        const isMaster = orm.isMaster();
        if (commit.tags.includes("create")) {
          const activeOrder = await orm(`${commit.collectionName}`).findOne({
            table: commit.data.table
          });
          if (activeOrder) {
            //create doNothing Commit here
            commit.id = (await orm.emit("getHighestCommitId")).value + 1;
            commit.approved = false;
            delete commit.chain;

            this.value = commit;
            return;
          }
        }
        this.value = commit;
      });
    }

    /*["transport:requireSync:callback", "transport:toMaster"].forEach(hook => {
      ormA.on(hook, () => hooks.emit(hook));
      ormC.on(hook, () => hooks.emit(hook));
    });*/

    toMasterLockA = ormA.getLock("transport:toMaster");
    toMasterLockC = ormC.getLock("transport:toMaster");
  });
  //</editor-fold>

  it("case 1", async function(done) {
    const fakeChannelA = ormA.getLock("fake-channel");
    const callbackLockA = ormA.getLock("transport:requireSync:callback");
    let arr = [];
    ormA.onCount("commit:handler:finish", count => {
      if (count === 4) {
        arr;
        done();
      }
    });

    hooks.onCount("transport:toMaster", count => {
      //if (count === 3) done();
    });

    ormA.on("beforeReturnValue", -2, function(query, target) {
      if (query.name === "Model" && target.isMutateCmd) {
        arr.push(query.chain[0]);
      }
    });

    await toMasterLockA.acquireAsync();
    const m1 = await ormA("Model")
      .create({ table: 10, items: [] })
      .commit("create", {
        table: 10
      });

    //await delay(200);
    //await callbackLock.acquireAsync();
    const m2 = await ormA("Model")
      .findOneAndUpdate({ _id: m1._id }, { $push: { items: "item1" } })
      .commit("addItem", {
        table: 10
      });

    //await fakeChannelA.acquireAsync();

    /*const m3 = await ormC('Model').create({table: 10}).commit("create", {
      table: 10
    });*/

    const m4 = await ormA("Model")
      .updateOne({ table: 10 }, { $push: { items: "item2" } })
      .commit("addItem", {
        table: 10
      });
    await toMasterLockA.release();
    const lock = new AwaitLock();
    await lock.acquireAsync();
    ormA.onQueueCount("transport:requireSync:callback", function(
      count,
      commits
    ) {
      if (count === 1) {
        this.keepLock();
        lock.release();
      } else if (count > 1) {
        const a = 5;
        //this.keepLock();
      }
    });
    await lock.acquireAsync();
    //
    const m5 = await ormA("Model")
      .updateOne({ table: 10 }, { $push: { items: "item3" } })
      .commit("addItem", {
        table: 10
      });

    expect(m5.items).toMatchInlineSnapshot(`
      Array [
        "item3",
      ]
    `);
    callbackLockA.release();

    //await callbackLockA.release();

    //await callbackLockA.release();
    //await toMasterLockA.release();
  }, 30000);
});
