const {
  checkEqual2,
  convertSchemaToPaths,
  findAllPathsInLevelArrHandler2,
  parseCondition
} = require("../schemaHandler");
const orm = require("../orm");
const {ObjectID} = require("bson");
const {stringify} = require("../utils");
const _ = require("lodash");
let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model, schema;
const uuid = require("uuid").v1;
const Socket = require('socket.io-mock');
const masterIo = new Socket();
const clientSocket = masterIo.socketClient;
const cloudIo = new Socket();
const cloudSocket = cloudIo.socketClient;
const Queue = require('queue');

describe("commit-sync", function () {
  beforeAll(async () => {
    orm.connect({uri: "mongodb://localhost:27017"}, "myproject");
    schema = {
      table: String
    };

  });

  it('test socket', function (done) {
    masterIo.on('test', function (arg) {
      console.log('test');
      done();
    })
    clientSocket.emit('test', 0, () => {

    });
  })

  it("commit-sync2", async function (done) {
    const Model = orm("Model");
    await Model.remove({})
    await orm('Commit').remove({});
    await orm('CommitMaster').remove({});

    orm.on("pre:execChain", async function (query) {
      const last = _.last(query.chain);
      if (last.fn === "commit") {
        query.chain.pop();
        query.mockCollection = true;
        let _chain = [...query.chain];
        const {args} = last;
        const commit = {
          collectionName: query.name,
          uuid: uuid(),
          tags: args.filter(arg => typeof arg === "string"),
          data: _.assign({}, ...args.filter(arg => typeof arg === "object")),
          chain: JSON.stringify(_chain),
          approved: false
        };

        //commitId: incremental
        //const CommitCol = orm(`${query.name}Commit`);
        //const _commit = await CommitCol.create(commit);
        //const r = await orm.emit(`commit:${query.name}`, commit, query);
        //_.assign(this, r);
        //remove later:
        query.commit = true;

        orm.once(`proxyPreReturnValue:${query.uuid}`, async function (_query, target) {
          if (_.get(_query, "chain[0].args[0]._id")) {
            commit.data.docId = _.get(_query, "chain[0].args[0]._id");
          }
          await orm.emit(`commitProcess`, commit, _query);
        });
        //test behavior if not create model
      }
    });

    function getQuery(commit) {
      const chain = JSON.parse(commit.chain);
      const name = commit.collectionName;
      return {name, chain}
    }

    orm.onDefault("commitProcess", async function (commit) {
      await orm.emit(`commit:build-fake`, commit);
      await orm.emit("toMaster", commit);
    });

    //todo: fake layer
    orm.on("commit:build-fake", async function (commit) {
      let doc = await orm.execChain(getQuery(commit));
      doc = await Model.updateOne({_id: doc._id}, {_fake: true})
      console.log('fake : ', doc);
    });

    orm.on("commit:remove-fake", async function (commit) {
      console.log('remove-fake');
      const docs = await Model.find({_fake: true});
      console.log(docs);
      await Model.remove({_id: {$in: docs.map(d => d._id)}});
    });

    orm.pre(`commit:requireSync`, async function () {
      const {value: highestId} = await orm.emit('getHighestCommitId');
      orm.emit('commit:sync', highestId);
    });

    orm.pre(`commit:sync`, async function () {
      await orm.emit('commit:remove-fake');
    })

    orm.on('createCommit:master', async function (commit) {
      let {value: highestId} = await orm.emit('getHighestCommitId', 'CommitMaster');
      highestId++;
      commit.approved = true;
      commit.id = highestId;
      this.value = await orm(`CommitMaster`).create(commit);
    })

    orm.on('getHighestCommitId', async function (collectionName = 'Commit') {
      const {id: highestCommitId} = await orm(collectionName).findOne({}).sort('-id') || {id: 0};
      this.value = highestCommitId;
    })

    orm.on('commit:sync:master', async function (clientHighestId, collectionName = 'CommitMaster') {
      this.value = await orm(collectionName).find({id: {$gt: clientHighestId}});
    })

    orm.on('commit:sync:callback', async function (commits) {
      for (const commit of commits) {
        //replace behaviour here
        try {
          await orm('Commit').create(commit);
          await orm.emit('commit:handler', commit);
        } catch (e) {
          if (e.message.slice(0, 6)) {
            console.log('sync two fast')
          }
        }
      }
      const models = await orm('Model').find({});
      console.log('apply commits from master : ');
      console.log(models);
    })

    orm.on('commit:handler', async commit => {
      const query = getQuery(commit);
      await orm.execChain(query);
    })

    //todo: layer transport implement

    orm.on('initSyncForClient', clientSocket => {
      const q = Queue({autostart: true});
      orm.on('toMaster', async (commit) => {
        clientSocket.emit('commitRequest', commit);
      })

      clientSocket.on('commit:requireSync', async function () {
        q.push(async function () {
          orm.emit('commit:requireSync');
        })
      })

      orm.on('commit:sync', (highestId) => {
        clientSocket.emit('commit:sync', highestId, async (commits) => {
          await orm.emit('commit:sync:callback', commits)
        })
      })
    })

    orm.on('initSyncForMaster', masterIo => {
      const q = Queue({autostart: true});
      masterIo.on('commitRequest', async (commit) => {
        q.push(async function () {
          const {value: _commit} = await orm.emit('createCommit:master', commit);
          masterIo.emit(`commit:requireSync`, _commit);
          cloudSocket.emit('commit:requireSync', 100);
        })
      });

      masterIo.on('commit:sync', async function (clientHighestId = 0, cb) {
        //q.push(async function () {
        const {value: commits} = await orm.emit('commit:sync:master', clientHighestId, 'CommitMaster');
        cb(commits);
        //})
      })
    })

    orm.on('initSyncForCloud', cloudIo => {
      cloudIo.on('commit:requireSync', highestId => {
      })
    })

    //layer init
    orm.emit('initSyncForClient', clientSocket);
    orm.emit('initSyncForMaster', masterIo);
    orm.emit('initSyncForCloud', cloudIo);

    //gen _id for parseSchema

    //order._fake = true;

    await Model.create({
      table: 10,
      items: [{name: "cola", price: 10, quantity: 1}]
    }).commit("update", {table: "10"});

    await Model.create({
      table: 11,
      items: [{name: "cola", price: 10, quantity: 1}]
    }).commit("update", {table: "11"});

    //fake chi apply voi cac lenh apply cho one document

    //todo: save chain in db: use 1 collection ?? compound index?
    //todo: fake + approve process:
  });
});
