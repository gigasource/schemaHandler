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

    let orms = [ormA, ormB];
    for (const orm of orms) {
      orm.plugin(syncPlugin);
      orm.plugin(require("./sync-transporter"));
    }

    ormA.plugin(require("./sync-flow"), "client");
    ormB.plugin(require("./sync-flow"), "master");

    ormA.emit("initSyncForClient", s1);
    ormB.emit("initSyncForMasterIo", masterIo);

    s1.connect("local");

    Model = ormA("Model");
    await ormA("Model").remove({});
    await ormA("Commit").remove({});
    await ormA("Recovery").remove({});
    await ormB("Model").remove({});
    await ormB("Commit").remove({});

    async function enableC() {
      ormC.connect({ uri: "mongodb://localhost:27017" }, "myproject3");
      s2.connect("local");

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

  it("prevent two same table", async function(done) {
    ormA.onCount("commit:handler:finish", count => {
      if (count === 2) {
        done();
      }
    });
    await toMasterLockA.acquireAsync();
    const m1 = await ormA("Model").create({ table: 10, items: [] });
    const m2 = await ormA("Model").create({ table: 10, items: [] });
    toMasterLockA.release();
  }, 30000);

  it("case only master", async function(done) {
    const m1 = await ormB("Model").create({ table: 10, items: [] });
    //const m2 = await ormB("Model").create({table: 10, items: []});
  }, 30000);

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

  it("case basic client create no master", async function() {
    toMasterLockA.acquireAsync();
    const m1 = await Model.create({ table: 10 }).commit("create", {
      table: 10
    });
    await delay(50);
    expect(stringify(await Model.find())).toMatchInlineSnapshot(`
      Array [
        Object {
          "_fake": true,
          "_id": "ObjectID",
          "table": 10,
        },
      ]
    `);
    expect(stringify(await orm("Recovery").find())).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "collectionName": "Model",
          "doc": Object {
            "_fake": true,
            "_id": "ObjectID",
            "table": 10,
          },
          "type": "create",
          "uuid": "uuid-v1",
        },
      ]
    `);
    expect(stringify(await orm("Commit").find())).toMatchObject([]);
    toMasterLockA.release();
    await delay(50);
    expect(stringify(await Model.find())).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "table": 10,
        },
      ]
    `);
    expect(stringify(await orm("Recovery").find())).toMatchInlineSnapshot(
      `Array []`
    );

    expect(stringify(await orm("Commit").find())).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "approved": false,
          "chain": "[{\\"fn\\":\\"insertOne\\",\\"args\\":[{\\"table\\":10,\\"_id\\":\\"ObjectID\\"}]}]",
          "collectionName": "Model",
          "condition": null,
          "data": Object {
            "docId": "ObjectID",
            "table": 10,
          },
          "id": 1,
          "tags": Array [
            "create",
            "create",
          ],
          "uuid": "uuid-v1",
        },
      ]
    `);
  });

  it("case create + findOneAndUpdate", async function() {
    toMasterLockA.acquireAsync();
    const m1 = await Model.create({ table: 10 }).commit("create", {
      table: 10
    });

    const m1a = await Model.findOneAndUpdate({ table: 10 }, { status: "paid" });
    await delay(50);
    expect(stringify(await Model.find())).toMatchSnapshot();
    expect(stringify(await orm("Recovery").find())).toMatchSnapshot();
    expect(stringify(await orm("Commit").find())).toMatchObject([]);
    toMasterLockA.release();
    await delay(500);
    const models = await Model.find();
    expect(stringify(models)).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "status": "paid",
          "table": 10,
        },
      ]
    `);
    expect(stringify(await orm("Recovery").find())).toMatchInlineSnapshot(
      `Array []`
    );
    expect(stringify(await orm("Commit").find())).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "approved": false,
          "chain": "[{\\"fn\\":\\"insertOne\\",\\"args\\":[{\\"table\\":10,\\"_id\\":\\"ObjectID\\"}]}]",
          "collectionName": "Model",
          "condition": null,
          "data": Object {
            "docId": "ObjectID",
            "table": 10,
          },
          "id": 1,
          "tags": Array [
            "create",
            "create",
          ],
          "uuid": "uuid-v1",
        },
        Object {
          "_id": "ObjectID",
          "approved": false,
          "chain": "[{\\"fn\\":\\"findOneAndUpdate\\",\\"args\\":[{\\"table\\":10},{\\"status\\":\\"paid\\"}]},{\\"fn\\":\\"setOptions\\",\\"args\\":[{\\"new\\":true}]}]",
          "collectionName": "Model",
          "condition": Object {
            "table": 10,
          },
          "data": Object {},
          "id": 2,
          "tags": Array [],
          "uuid": "uuid-v1",
        },
      ]
    `);
  });

  it("test raw", async function() {
    const raw = await ormA("Model")
      .create({ table: 10 })
      .raw();

    const model = await ormA.execChain(raw, true);

    expect(stringify(model)).toMatchInlineSnapshot(`
      Object {
        "_id": "ObjectID",
        "table": 10,
      }
    `);
  });
});
