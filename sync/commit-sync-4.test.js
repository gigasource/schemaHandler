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
const syncPlugin = require("./sync-plugin");
let toMasterLock;

describe("commit-sync", function() {
  beforeAll(async () => {
    ormA.connect({ uri: "mongodb://localhost:27017" }, "myproject");
    ormB.connect({ uri: "mongodb://localhost:27017" }, "myproject2");

    ormA.plugin(syncPlugin, "client");
    ormA.emit("initSyncForClient", clientSocket);

    ormB.plugin(syncPlugin, "master");
    ormB.emit("initSyncForMaster", masterIo);

    Model = ormA("Model");
    await ormA("Model").remove({});
    await ormA("Commit").remove({});
    await ormA("Recovery").remove({});
    await ormB("Model").remove({});
    await ormB("Commit").remove({});

    for (const orm of [ormA, ormB]) {
      orm.registerCommitBaseCollection('Model');
      orm.on(`commit:auto-assign:Model`,( commit, _query, target) => {
        if (target.cmd === 'create') {
          commit.data.table = _.get(_query, "chain[0].args[0].table")
          commit.tags.push('create')
        }
      });

      orm.onQueue("createCommit:master", async function(commit) {
        const {chain} = orm.getQuery(commit);
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
            if (orm.isMaster()) {
              this.value = await orm(`Commit`).create(commit);
            }
            return;
          }
        }
        const result = await orm.emitDefault("createCommit:master", commit);
        this.value = result['value'];
      });
    }

    let called = 0;
    orm.on("commit:sync:callback", () => {
      called++;
      orm.emit(`commit:sync:callback:${called}`);
    });

    toMasterLock = orm.getLock("toMaster");
  });

  it("case basic client create no master", async function() {
    //toMasterLock.acquireAsync();
    const m1 = await Model.create({ table: 10 });
    const m2 = await Model.create({ table: 10 });
    await delay(1000);
  }, 20000);


});
