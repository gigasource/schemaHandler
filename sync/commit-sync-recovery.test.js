//<editor-fold desc="declaration">
const Orm = require("../orm");
let ormA = new Orm();
ormA.name = "A";
let ormB = new Orm();
ormB.name = "B";
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
let toMasterQueueA, toMasterQueueC;
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
      orm.plugin(require("./sync-queue-commit"));
      orm.plugin(require("./sync-transporter"));
    }

    ormA.plugin(require("./sync-flow"), "client");
    ormB.plugin(require("./sync-flow"), "master");

    ormA.emit("initSyncForClient", s1);
    masterIo.on("connect", socket => {
      ormB.emit("initSyncForMaster", socket);
    });

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
      orm.registerSchema("Model", {
        items: [{}]
      });
      orm.registerCommitBaseCollection("Model");
      orm.on(`commit:auto-assign:Model`, (commit, _query, target) => {
        if (target.cmd === "create") {
          commit.data.table = _.get(_query, "chain[0].args[0].table");
          commit.tags.push("create");
        }
      });

      /*orm.onQueue("process:commit:create", async function(commit) {
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
      });*/
    }

    /*["transport:requireSync:callback", "transport:toMaster"].forEach(hook => {
      ormA.on(hook, () => hooks.emit(hook));
      ormC.on(hook, () => hooks.emit(hook));
    });*/

    toMasterQueueA = ormA.getQueue("transport:toMaster");
    toMasterQueueC = ormC.getQueue("transport:toMaster");
  });
  //</editor-fold>

  it("prevent two same table", async function(done) {
    ormA.onCount("commit:handler:finish", count => {
      if (count === 2) {
        done();
      }
    });
    await toMasterQueueA.stop();
    const m1 = await ormA("Model").create({ table: 10, items: [] });
    const m2 = await ormA("Model").create({ table: 10, items: [] });
    toMasterQueueA.start();
  }, 30000);

  it("flow", async function(done) {
    const m1 = await ormA("Model").create({ table: 10, items: [] });
  }, 30000);

  it("case only master", async function(done) {
    const m1 = await ormB("Model").create({ table: 10, items: [] });
    //const m2 = await ormB("Model").create({table: 10, items: []});
  }, 30000);

  it("sync bug", async function(done) {
    const greenTea = { name: "greenTea", quantity: 1, _id: new ObjectID() };
    const soda = { name: "soda", quantity: 1, _id: new ObjectID() };
    const _id = new ObjectID();
    const Model = ormA("Model");
    await Model.create({ _id, table: 10, items: [greenTea] });
    await Model.updateOne({ _id }, { $push: { items: { $each: [soda] } } });
    await Model.updateOne({ _id }, { $set: { table: 1 } });
    await Model.updateOne(
      { _id },
      { $pull: { items: { _id: { $in: [greenTea._id] } } } }
    );
    await Model.updateOne({ _id }, { $set: { sum: 5 } });
    //await delay(200);
    const m2 = await Model.findOne();
    debugger;
  });

  it("case 1", async function(done) {
    const fakeChannelA = ormA.getQueue("fake-channel");
    const callbackLockA = ormA.getQueue("transport:requireSync:callback");
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

    await toMasterQueueA.stop();
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
    await toMasterQueueA.start();
    const lock = new AwaitLock();
    await lock.acquireAsync();
    ormA.onQueueCount("transport:requireSync:callback", function(
      count,
      commits
    ) {
      if (count === 1) {
        //this.keepLock();
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

    //await delay(1000);
    //const models = await ormB('Model').find();
    //debugger

    expect(m5.items).toMatchInlineSnapshot(`
      Array [
        "item3",
      ]
    `);
    //callbackLockA.release();

    //await callbackLockA.release();

    //await callbackLockA.release();
    //await toMasterLockA.release();
  }, 30000);

  it("case 2 auto gen _id", async function(done) {
    const m1 = await ormA("Model")
      .create({ table: 10, items: [{ a: 1 }] })
      .commit("create", {
        table: 10
      });

    await delay(50);

    const m2 = await ormB("Model").findOne({});
    expect(m1._id.toString() === m2._id.toString()).toBe(true);
    expect(m1.items[0]._id.toString() === m2.items[0]._id.toString()).toBe(
      true
    );
    done();
  }, 30000);

  it("case basic client create no master", async function() {
    toMasterQueueA.acquireAsync();
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
    toMasterQueueA.release();
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
    toMasterQueueA.acquireAsync();
    const m1 = await Model.create({ table: 10 }).commit("create", {
      table: 10
    });

    const m1a = await Model.findOneAndUpdate({ table: 10 }, { status: "paid" });
    await delay(50);
    expect(stringify(await Model.find())).toMatchSnapshot();
    expect(stringify(await orm("Recovery").find())).toMatchSnapshot();
    expect(stringify(await orm("Commit").find())).toMatchObject([]);
    toMasterQueueA.release();
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

  it("case create + findOneAndUpdate 2", async function() {
    const m1 = await Model.create({ table: 10 }).commit("create", {
      table: 10
    });

    const m1a = await Model.findOneAndUpdate({ table: 10 }, { status: "paid" });
    await delay(50);
    expect(stringify(await Model.find())).toMatchSnapshot();
    await delay(500);
    const models = await Model.find();
    expect(stringify(models)).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "items": Array [],
          "status": "paid",
          "table": 10,
        },
      ]
    `);
    expect(stringify(await orm("Recovery").find())).toMatchInlineSnapshot(
      `Array []`
    );
    const data = await ormB("Model").findOne({ _id: m1._id });
    expect(data).toEqual(m1a);
    expect(stringify(await orm("Commit").find())).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "approved": false,
          "chain": "[{\\"fn\\":\\"insertOne\\",\\"args\\":[{\\"table\\":10,\\"_id\\":\\"ObjectID\\",\\"items\\":[]}]}]",
          "collectionName": "Model",
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
          "condition": "{\\"table\\":10}",
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

  it("test batch", async function() {
    //const raw = await ormA("Model").create({ table: 10 }).batch();
    await ormA("Model").create({ table: 10 });
    //const raw = await ormA("Model").updateOne({ table: 10 }, {name: 'A'}, {upsert: true}).batch();
    //const raw = await ormA("Model").updateMany({ table: 10 }, {name: 'A'}, {upsert: true}).batch();
    const raw = await ormA("Model")
      .replaceOne({ table: 10 }, { table: 11 })
      .batch();

    expect(stringify(raw)).toMatchInlineSnapshot(`
      Object {
        "replaceOne": Object {
          "filter": Object {
            "table": 10,
          },
          "replacement": Object {
            "_id": "ObjectID",
            "items": Array [],
            "table": 11,
          },
        },
      }
    `);
  });

  it("test batch2", async function() {
    const raw1 = await ormA("Model")
      .create({ table: 10 })
      .batch();
    const raw2 = await ormA("Model")
      .updateOne({ table: 10 }, { $set: { name: "A" } })
      .batch();

    const result = await ormA("Model").bulkWrite([raw1, raw2]);
    const models = await ormA("Model").find();
    expect(stringify(result)).toMatchInlineSnapshot(`
      Object {
        "insertedIds": Array [
          Object {
            "_id": "ObjectID",
            "index": 0,
          },
        ],
        "nInserted": 1,
        "nMatched": 1,
        "nModified": 1,
        "nRemoved": 0,
        "nUpserted": 0,
        "ok": 1,
        "upserted": Array [],
        "writeConcernErrors": Array [],
        "writeErrors": Array [],
      }
    `);
  });
});
