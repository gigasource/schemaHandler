const Orm = require("../orm");
let ormA = new Orm();
let ormB = new Orm();
const orm = ormA;
const {ObjectID} = require("bson");
const {stringify} = require("../utils");
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
let toMasterLock;

describe("commit-sync", function () {
  beforeAll(async () => {
    ormA.connect({uri: "mongodb://localhost:27017"}, "myproject");
    ormB.connect({uri: "mongodb://localhost:27017"}, "myproject2");
    ormB.setMultiDbMode();

    ormA.plugin(syncPlugin, "client");
    ormA.emit("initSyncForClient", clientSocket);

    ormB.plugin(syncPlugin, "master");
    ormB.emit("initSyncForMaster", masterIo);

    Model = ormA("Model");
    await ormA("Model").remove({});
    await ormA("Commit").remove({});
    await ormA("Recovery").remove({});
    await ormB("Model", 'myproject-m1').remove({});
    await ormB("Commit", 'myproject-m1').remove({});

    ormA.on('commit:auto-assign', (commit, query, target) => {
      commit.dbName = 'myproject-m1'
    });

    ormA.on('commit:sync:args', args => {
      args.push('myproject-m1');
    })

    for (const orm of [ormA, ormB]) {
      orm.registerCommitBaseCollection('Model');
      orm.on(`commit:auto-assign:Model`, (commit, query, target) => {
        if (target.cmd === 'create') {
          commit.data.table = _.get(query, "chain[0].args[0].table")
          commit.tags.push('create')
        }
      });

      orm.onQueue("createCommit", async function (commit) {
        const {chain} = orm.getQuery(commit);
        const isMaster = orm.isMaster();
        if (commit.tags.includes("create")) {
          const activeOrder = await orm(commit.collectionName, commit.dbName).findOne({
            table: commit.data.table
          });
          if (activeOrder) {
            //create doNothing Commit here
            commit.id = (await orm.emit("getHighestCommitId")).value + 1;
            commit.approved = false;
            delete commit.chain;

            this.value = commit;
            if (orm.isMaster()) {
              this.value = await orm(`Commit`, commit.dbName).create(commit);
            }
            return;
          }
        }
        const result = await orm.emitDefault("createCommit", commit);
        this.value = result['value'];
      });
    }

    let called = 0;
    orm.on("transport:requireSync:callback", () => {
      called++;
      orm.emit(`transport:requireSync:callback:${called}`);
    });

    toMasterLock = orm.getLock("transport:toMaster");
  });

  it("case basic client create no master", async function (done) {
    //toMasterLock.acquireAsync();
    orm.on("transport:requireSync:callback:2", done);
    const m1 = await Model.create({table: 10});
    const m2 = await Model.create({table: 11});
  }, 20000);

  it("case update one", async function (done) {
    //toMasterLock.acquireAsync();
    //orm.on("transport:requireSync:callback:2", done);
    const m1 = await Model.create({table: 10});
  }, 20000);


});
