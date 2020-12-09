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
const delay = require('delay');


// split master + client + cloud -> multi db + multiprocess ??
async function init() {
  Model = orm("Model");
  await Model.remove({})
  await orm('Commit').remove({});
  await orm('CommitMaster').remove({});
  await orm('Recovery').remove({});
  await orm('ModelMaster').remove({});

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

      orm.once(`proxyPreReturnValue:${query.uuid}`, async function (_query, target, exec) {
        if (_.get(_query, "chain[0].args[0]._id")) {
          commit.data.docId = _.get(_query, "chain[0].args[0]._id");
        }
        let value;
        await orm.emit('commit:build-fake', _query, target, exec, commit, e => eval(e));
        await orm.emit("transport:toMaster", commit, _query);
        this.value = value;
      });
      //test behavior if not create model
    }
  });

  function getQuery(commit) {
    const chain = JSON.parse(commit.chain || '[]');
    const name = commit.collectionName;
    return {name, chain}
  }

  orm.on('initFakeLayer', function () {
    //todo: fake layer
    orm.onQueue("commit:build-fake", 'fake-channel', async function (query, target, exec, commit) {
      if (!target.isMutateCmd) {
        return this.update('value', await exec());
      }
      const _uuid = {uuid: commit.uuid};
      //case findOneAndUpdate upsert ??
      //case updateMany
      //case delete || remove
      //case create many
      //todo: assign docId, (s)

      //todo: One
      if (!target.condition) {
        //case create, insert
        let value = await exec();
        //add recovery layer:
        await orm('Recovery').create({collectionName: query.name, ..._uuid});
        if (Array.isArray(value)) {
          for (const doc of value) {
            const _doc = await orm(query.name).updateOne({_id: doc._id}, {$set: {_fake: true}});
            value.splice(value.indexOf(doc), 1, _doc);
          }
          return this.update('value', value);
        } else {
          value = await orm(query.name).updateOne({_id: value._id}, {$set: {_fake: true}});
          return this.update('value', value);
        }
      } else if (target.returnSingleDocument) {
        const doc = await orm(query.name).findOne(target.condition);
        if (doc && !doc._fake) {
          await orm('Recovery').create({
            collectionName: query.name,
            doc,
            ..._uuid
          });
        }
        let value = await exec();
        if (value) {
          value = await orm(query.name).updateOne(target.condition, {$set: {_fake: true}});
        }
        this.update('value', value);
      } else {
        //updateMany
        const docs = await orm(query.name).find(target.condition);
        const jobs = []
        for (const doc of docs) {
          if (!doc._fake) {
            await orm('Recovery').create({
              collectionName: query.name,
              doc,
              ..._uuid
            });
            jobs.push(async () => await orm(query.name).updateOne({_id: doc._id}, {$set: {_fake: true}}))
          }
        }
        let value = await exec();
        for (const job of jobs) await job();
        return this.update('value', value);
      }
      //let doc = await orm.execChain(getQuery(commit));
      //doc = await Model.updateOne({_id: doc._id}, {_fake: true})
      // console.log('fake : ', doc);
    });

    orm.onQueue("commit:remove-fake", 'fake-channel', async function (commit) {
      console.log('remove-fake');
      const recoveries = await orm('Recovery').find({uuid: commit.uuid});
      const cols = Object.keys(_.groupBy(recoveries, r => r.collectionName));
      for (const col of cols) {
        await orm(col).remove({_fake: true});
      }

      for (const recovery of recoveries) {
        if (recovery.doc) await orm(recovery.collectionName).create(recovery.doc);
      }
      await orm('Recovery').remove({uuid: commit.uuid});
    });
  })

  //should transparent
  orm.pre(`commit:requireSync`, async function () {
    const {value: highestId} = await orm.emit('getHighestCommitId');
    orm.emit('commit:sync', highestId);
  });
  orm.on('getHighestCommitId', async function (collectionName = 'Commit') {
    const {id: highestCommitId} = await orm(collectionName).findOne({}).sort('-id') || {id: 0};
    this.value = highestCommitId;
  })
  //should transparent
  orm.on('transport:requireSync:callback', async function (commits) {
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
  })

  //customize
  orm.onQueue('commit:handler', async commit => {
    await orm.emit('commit:remove-fake', commit);
    const query = getQuery(commit);
    await orm.execChain(query);
  })

  //use only for master
  orm.onDefault('createCommit', async function (commit) {
    let {value: highestId} = await orm.emit('getHighestCommitId', 'CommitMaster');
    highestId++;
    commit.approved = true;
    commit.id = highestId;
    this.value = await orm(`CommitMaster`).create(commit);
  })

  orm.on('update:CommitMaster:c', async function (commit) {
    const query = getQuery(commit);
    query.name = `${query.name}Master`;
    await orm.execChain(query);

    await orm.emit('master:commit:requireSync');
  })

  orm.on('commit:sync:master', async function (clientHighestId, collectionName = 'CommitMaster') {
    this.value = await orm(collectionName).find({id: {$gt: clientHighestId}});
  })

  if (process.env.NODE_ENV === 'test') {
    let called = 0;
    orm.on('transport:requireSync:callback', async function (commits) {
      called++;
      if (called === 2) {
        orm.emit('done');
      }
    })
  }

  //todo: layer transport implement

  orm.on('initSyncForClient', clientSocket => {
    orm.on('transport:toMaster', async commit => clientSocket.emit('commitRequest', commit))

    clientSocket.on('commit:requireSync', async () => {
      orm.emit('commit:requireSync');
    })

    orm.on('commit:sync', (highestId) => {
      clientSocket.emit('commit:sync', highestId, async (commits) => {
        await orm.emit('transport:requireSync:callback', commits)
      })
    })
  })

  orm.on('initSyncForMaster', masterIo => {
    masterIo.on('commitRequest', async (commit) => {
      await orm.emit('createCommit', commit);
      //masterIo.emit(`commit:requireSync`);
      //cloudSocket.emit('commit:requireSync', 100);
    });

    orm.on('master:commit:requireSync', () => {
      masterIo.emit(`commit:requireSync`);
    });

    masterIo.on('commit:sync', async function (clientHighestId = 0, cb) {
      const {value: commits} = await orm.emit('commit:sync:master', clientHighestId, 'CommitMaster');
      cb(commits);
    })
  })

  orm.on('initSyncForCloud', cloudIo => {
    cloudIo.on('commit:requireSync', highestId => {
    })
  })

  orm.emit('initFakeLayer');
  //layer init
  orm.emit('initSyncForClient', clientSocket);
  //orm.emit('initSyncForMaster', masterIo);
  orm.emit('initSyncForCloud', cloudIo);

}

describe("commit-sync", function () {
  beforeAll(async () => {
    orm.connect({uri: "mongodb://localhost:27017"}, "myproject");
    schema = {
      table: String
    };
    await init();
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
    orm.on('done', done);
    orm.emit('initSyncForMaster', masterIo);
    const m1 = await Model.create([{
      table: 10,
      items: [{name: "cola", price: 10, quantity: 1}]
    }, {table: 12}]).commit("create", {table: "10"});

    /*const m2 = await Model.create({
      table: 10,
      items: [{name: "cola", price: 10, quantity: 1}]
    }).commit("create", {table: "10"});*/

    //await delay(100);
    const m = await Model.updateMany({}, {table: 11}).commit("update", {table: "11"});

    /*await Model.create({
      table: 11,
      items: [{name: "cola", price: 10, quantity: 1}]
    }).commit("update", {table: "11"});*/

    //fake chi apply voi cac lenh apply cho one document

    //todo: save chain in db: use 1 collection ?? compound index?
    //todo: fake + approve process:
  });

  it("case Create Many", async function (done) {
    orm.emit('initSyncForMaster', masterIo);
    const m1 = await Model.create([{
      table: 10,
      items: [{name: "cola", price: 10, quantity: 1}]
    }, {table: 12}]).commit("create", {table: "10"});
  });

  it("case remove", async function (done) {
    orm.on('done', done);
    const m1 = await Model.create([{
      table: 10,
      items: [{name: "cola", price: 10, quantity: 1}]
    }, {table: 12}]).commit("create", {table: "10"});

    const m = await Model.remove({table: 12}).commit("delete", {table: "12"});
  });

  it("order resolve conflict: can not create table", async function (done) {
    orm.emit('initSyncForMaster', masterIo);
    orm.on('createCommit', async function (commit) {
      if (commit.tags.includes('create')) {
        const activeOrder = await orm(`${commit.collectionName}Master`).findOne({table: commit.data.table});
        if (activeOrder) {
          //create doNothing Commit here
          commit.id = (await orm.emit('getHighestCommitId', 'CommitMaster')).value + 1;
          commit.approved = false;
          delete commit.chain;

          this.value = await orm(`CommitMaster`).create(commit);
          return;
        }
      }
      await orm.emitDefault('createCommit', commit);
    });
    //problems : prevent Model.create({table: 10})
    const m1 = await Model.create({table: 10}).commit('create', {table: 10});
    const m2 = await Model.create({table: 10}).commit('create', {table: 10});
  });


});
