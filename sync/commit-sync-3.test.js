const {
  checkEqual2,
  convertSchemaToPaths,
  findAllPathsInLevelArrHandler2,
  parseCondition
} = require("../schemaHandler");
const Orm = require("../orm");
let ormA = new Orm();
let ormB = new Orm();
const orm = ormA;
const { ObjectID } = require("bson");
const { stringify } = require("../utils");
const _ = require("lodash");
let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model, schema;
const uuid = require("uuid").v1;
const Socket = require("socket.io-mock");
const masterIo = new Socket();
const clientSocket = masterIo.socketClient;
const cloudIo = new Socket();
const cloudSocket = cloudIo.socketClient;
const Queue = require("queue");
const delay = require("delay");
const syncPlugin = require("./sync-plugin-multi");
const syncFlow = require('./sync-flow');
let toMasterLock;

describe("commit-sync", function() {
  beforeAll(async () => {
    ormA.connect({ uri: "mongodb://localhost:27017" }, "myproject");
    ormB.connect({ uri: "mongodb://localhost:27017" }, "myproject2");

    ormA.plugin(syncPlugin);
    ormA.plugin(syncFlow);
    await ormA.emit('commit:flow:setMaster', false)
    ormA.emit("initSyncForClient", clientSocket);

    ormB.plugin(syncPlugin);
    ormB.plugin(syncFlow)
    await ormB.emit('commit:flow:setMaster', true)
    masterIo.on('connect', (socket) => {
      console.log('123')
      ormB.emit('initSocketForMaster', socket)
    })

    Model = ormA("Model");
    await ormA("Model").remove({});
    await ormA("Commit").remove({});
    await ormA("Recovery").remove({});
    await ormB("Model").remove({});
    await ormB("Commit").remove({});

    for (const orm of [ormA, ormB]) {
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

    let called = 0;
    orm.on("transport:requireSync:callback", () => {
      called++;
      orm.emit(`transport:requireSync:callback:${called}`);
    });

    toMasterLock = orm.getLock("transport:toMaster");
  });

  it("order resolve conflict: can not create table", async function(done) {
    //problems : prevent Model.create({table: 10})
    const m1 = await Model.create({ table: 10 }).commit("create", {
      table: 10
    });
    const m2 = await Model.create({ table: 10 }).commit("create", {
      table: 10
    });
    done()
  });

  it("case only master", async function(done) {
    const Model = ormB("Model");

    orm.on("transport:requireSync:callback:2", async () => {
      const models = await Model.find({});
      expect(stringify(models)).toMatchSnapshot();
      done();
    });

    const m1 = await Model.create({ table: 10 });
    const m2 = await Model.create({ table: 10 });
    expect(stringify([m1, m2])).toMatchSnapshot();
  });

  it("case basic client create no master", async function() {
    toMasterLock.acquireAsync();
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
    toMasterLock.release();
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
          "approved": true,
          "chain": "[{\\"fn\\":\\"create\\",\\"args\\":[{\\"table\\":10}]}]",
          "collectionName": "Model",
          "data": Object {
            "docId": "5fd0963fc630898689265c9c",
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
    toMasterLock.acquireAsync();
    const m1 = await Model.create({ table: 10 }).commit("create", {
      table: 10
    });

    const m1a = await Model.findOneAndUpdate({ table: 10 }, { status: "paid" });
    await delay(50);
    expect(stringify(await Model.find())).toMatchSnapshot();
    expect(stringify(await orm("Recovery").find())).toMatchSnapshot();
    expect(stringify(await orm("Commit").find())).toMatchObject([]);
    toMasterLock.release();
    await delay(50);
    expect(stringify(await Model.find())).toMatchSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "table": 10,
        },
      ]
    `);
    expect(stringify(await orm("Recovery").find())).toMatchSnapshot(`Array []`);
    expect(stringify(await orm("Commit").find())).toMatchSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "approved": true,
          "chain": "[{\\"fn\\":\\"create\\",\\"args\\":[{\\"table\\":10}]}]",
          "collectionName": "Model",
          "data": Object {
            "docId": "5fcdba6b26f1fe37ef2da6a2",
            "table": 10,
          },
          "id": 1,
          "tags": Array [
            "create",
          ],
          "uuid": "uuid-v1",
        },
      ]
    `);
  });
});
