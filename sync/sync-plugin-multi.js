const _ = require('lodash');
const {parseCondition, parseSchema} = require("../schemaHandler");
const uuid = require('uuid').v1;
const JsonFn = require('json-fn');
const {ObjectID} = require('bson')

const syncPlugin = function (orm) {
  const whitelist = []

  orm.registerCommitBaseCollection = function () {
    whitelist.push(...arguments);
  }

  orm.on('pre:execChain', -2, function (query) {
    const last = _.last(query.chain);
    if (last.fn === "batch") {
      query.chain.pop();
      this.stop();
      query.mockCollection = true;
      orm.once(`proxyPreReturnValue:${query.uuid}`, async function (_query, target, exec) {
        const {fn, args} = _query.chain[0];
        let value;
        if (fn === 'insertOne') {
          value = {insertOne: {document: args[0]}}
        } else if (fn === 'findOneAndUpdate') {
          value = {
            updateOne: {
              "filter": args[0],
              "update": args[1],
              ... args[2] && args[2]
            }
          }
        } else if (fn === 'updateMany') {
          value = {
            updateMany: {
              "filter": args[0],
              "update": args[1],
              ... args[2] && args[2]
            }
          }
        } else if (fn === 'deleteOne') {
          value = {deleteOne: {document: args[0]}}
        } else if (fn === 'deleteMany') {
          value = {deleteMany: {document: args[0]}}
        } else if (fn === 'replaceOne') {
          value = {
            replaceOne: {
              "filter": args[0],
              "replacement": args[1],
              ... args[2] && args[2]
            }
          }
        }
        this.value = value;
      })
    }
  })

  orm.on('pre:execChain', -1, function (query) {
    const last = _.last(query.chain);
    if (last.fn === "raw") {
      query.chain.pop();
      this.ok = true;
      this.value = query;
    } else if (last.fn === "direct") {
      query.chain.pop();
      this.stop();
    } else {
      if (whitelist.includes(query.name) && !query.chain.find(c => c.fn === 'commit')) {
        const cmds = ['update', 'Update', 'create', 'insert', 'remove', 'delete']
        let mutateCmd = false;
        query.chain.forEach(({fn}) => {
          for (const cmd of cmds) {
            if (fn.includes(cmd)) return mutateCmd = true;
          }
        })
        if (mutateCmd) {
          query.chain.push({fn: 'commit', args: []})
        }
      }
    }
  })

  orm.on('commit:auto-assign', function (commit, _query, target) {
    if (target.cmd === "create" || target.cmd === "insertOne") {
      const schema = orm.getSchema(target.collectionName, target.dbName) || orm.defaultSchema;
      _query.chain["0"].args["0"] = parseSchema(schema, _query.chain["0"].args["0"]);
    }
  })

  orm.on('pre:execChain', async function (query) {
    const last = _.last(query.chain);
    if (last.fn === "commit") {
      query.chain.pop();
      query.mockCollection = true;
      let _chain = [...query.chain];
      const {args} = last;
      const commit = {
        collectionName: query.name.split('@')[0],
        ...query.name.split('@')[1] && {
          dbName: query.name.split('@')[1]
        },
        uuid: uuid(),
        tags: args.filter(arg => typeof arg === "string"),
        data: _.assign({}, ...args.filter(arg => typeof arg === "object")),
        //chain: JSON.stringify(_chain),
        approved: false
      };

      orm.once(`proxyPreReturnValue:${query.uuid}`, async function (_query, target, exec) {
        commit._id = new ObjectID()
        commit.condition = JSON.stringify(target.condition);
        orm.emit(`commit:auto-assign`, commit, _query, target);
        orm.emit(`commit:auto-assign:${_query.name}`, commit, _query, target);
        commit.chain = JSON.stringify(_query.chain);
        if (_.get(_query, "chain[0].args[0]._id")) {
          commit.data.docId = _.get(_query, "chain[0].args[0]._id");
        }
        // put processCommit here
        const {value: value} = await orm.emit('commit:flow:execCommit', _query, target, exec, commit);
        // const {value: _commit} = await orm.emit('createCommit:master', _.cloneDeep(commit)); // todo fix this
        // if (_commit.chain !== commit.chain) {
        //   exec = async () => await orm.execChain(getQuery(commit))
        // }
        // await orm.emit('commit:build-fake', _query, target, exec, _commit, e => eval(e));
        // let lock = new AwaitLock();
        // if (isMaster) {
        //   lock.acquireAsync();
        //   orm.once(`commit:result:master:${commit.uuid}`, function (result) {
        //     value = result;
        //     lock.release();
        //   });
        // }
        // orm.emit("transport:toMaster", commit, _query);
        // if (isMaster) {
        //   await lock.acquireAsync();
        // }
        this.value = value;
      });
    }
  });

  function getQuery(commit) {
    const chain = JsonFn.parse(commit.chain || '[]');
    let name = commit.collectionName;
    return {name, chain}
  }

  orm.getQuery = getQuery;

  orm.on('initFakeLayer', function () {
    //todo: fake layer
    orm.onQueue("commit:build-fake", 'fake-channel', async function (query, target, exec, commit) {
      if (!commit.chain) return;

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
        if (Array.isArray(value)) {
          for (const doc of value) {
            const _doc = await orm(query.name).updateOne({_id: doc._id}, {$set: {_fake: true}}).direct();
            value.splice(value.indexOf(doc), 1, _doc);
            await orm('Recovery').create({collectionName: query.name, ..._uuid, type: 'create', doc: _doc});
          }
          return this.update('value', value);
        } else {
          value = await orm(query.name).updateOne({_id: value._id}, {$set: {_fake: true}}).direct();
          await orm('Recovery').create({collectionName: query.name, ..._uuid, type: 'create', doc: value});
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
        }/* else {
          const _recovery = await orm('Recovery').findOne({'doc._id': doc._id});
          await orm('Recovery').create({
            collectionName: query.name,
            doc: _recovery.doc,
            ..._uuid
          });
        }*/
        let value = await exec();
        if (!doc) {
          await orm('Recovery').create({collectionName: query.name, ..._uuid, type: 'create', doc: value})
        }
        if (value) {
          value = await orm(query.name).updateOne({_id: value._id}, {$set: {_fake: true}}).direct();
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
            jobs.push(async () => await orm(query.name).updateOne({_id: doc._id}, {$set: {_fake: true}}).direct())
          }/* else {
            const _recovery = await orm('Recovery').findOne({'doc._id': doc._id});
            await orm('Recovery').create({
              collectionName: query.name,
              doc: _recovery.doc,
              ..._uuid
            });
          }*/
        }
        let value = await exec();
        for (const job of jobs) await job();
        return this.update('value', value);
      }
      //let doc = await orm.execChain(getQuery(commit));
      //doc = await Model.updateOne({_id: doc._id}, {_fake: true})
      // console.log('fake : ', doc);
    });

    orm.on("commit:remove-fake", async function (commit) {
      //if (orm.name !== 'A') return;
      let _parseCondition = commit.condition ? JsonFn.parse(commit.condition) : {}
      let recoveries = await orm('Recovery').find({uuid: commit.uuid});

      if (recoveries.length === 0) {
        const schema = orm.getSchema(commit.collectionName, commit.dbName);
        _parseCondition = parseCondition(schema, _parseCondition);
        const condition = _.mapKeys(_parseCondition, (v, k) => `doc.${k}`)
        recoveries = await orm('Recovery').find(condition);
      }
      for (const recovery of recoveries) {
        if (recovery.type === 'create') {
          await orm(recovery.collectionName).remove({_id: recovery.doc._id}).direct();
        } else {
          await orm(recovery.collectionName).replaceOne({_id: recovery.doc._id}, recovery.doc, { upsert: true }).direct();
        }
        await orm('Recovery').remove({_id: recovery._id});
      }

    });

    orm.on('commit:remove-all-recovery', 'fake-channel', async function () {
      await orm('Recovery').remove({})
    })
  })

  //should transparent
  // orm.on(`transport:sync`, async function () {
  //   const {value: highestId} = await orm.emit('getHighestCommitId');
  //   orm.emit('transport:require-sync', highestId);
  // });
  orm.on('getHighestCommitId', async function (dbName) {
    let highestCommitId
    const commitData = await orm('CommitData', dbName).findOne({})
    if (!commitData || !commitData.highestCommitId)
      highestCommitId = (await orm('Commit', dbName).findOne({}).sort('-id') || {id: 0}).id;
    else
      highestCommitId = commitData.highestCommitId
    this.value = highestCommitId;
  })

  //should transparent
  orm.onQueue('transport:requireSync:callback', async function (commits) {
    if (!commits || !commits.length) return
    try {
      for (const commit of commits) {
        //replace behaviour here
        await orm.emit('createCommit', commit)
      }
    } catch (err) {
      console.log('Error in hook transport:requireSync:callback')
    }
    orm.emit('commit:handler:doneAllCommits')
    console.log('Done requireSync', commits.length, commits[0]._id, new Date())
  })
  //customize
  orm.onDefault('createCommit', async function (commit) {
    if (!commit.id) {
      const { value: highestId } = await orm.emit('getHighestCommitId', commit.dbName);
      commit.id = highestId + 1;
    } else {
      // commit with id smaller than highestId has been already created
      const { value: highestId } = await orm.emit('getHighestCommitId', commit.dbName)
      if (commit.id <= highestId)
        return // Commit exists
    }
    try {
      this.value = await orm(`Commit`, commit.dbName).create(commit);
    } catch (e) {
      if (e.message.slice(0, 6) === 'E11000') {
        //console.log('sync two fast')
      }
    }
    // if (isMaster) {
    //   this.value = await orm(`Commit`, commit.dbName).create(commit);
    // }
  })

  orm.onDefault('process:commit', async function (commit) {
    commit.approved = true;
    this.value = commit;
  })

  orm.on('commit:sync:master', async function (clientHighestId, dbName) {
    this.value = await orm('Commit', dbName).find({id: {$gt: clientHighestId}});
  })

  orm.onQueue('commitRequest', async function (commits) {
    try {
      if (!commits || !commits.length)
        return
      for (let commit of commits) {
        if (!commit.tags) {
          await orm.emit(`process:commit:${commit.collectionName}`, commit)
        } else {
          for (const tag of commit.tags) {
            await orm.emit(`process:commit:${tag}`, commit)
          }
        }
        await orm.emit('createCommit', commit);
      }
    } catch (err) {
      console.log('Error in commitRequest')
    }

    orm.emit('commit:handler:doneAllCommits')
    console.log('Done commitRequest', commits.length, commits[0]._id, new Date())
  })

  async function removeFake() {
    for (const collection of whitelist) {
      const docs = await orm(collection).find()
      for (const doc of docs) {
        if (doc._fake) {
          await orm(collection).remove({_id: doc._id}).direct()
          delete doc._fake
          await orm(collection).create(doc)
        }
      }
    }
  }

  async function removeAll() {
    await orm('Commit').deleteMany()
    for (const collection of whitelist) {
      await orm(collection).remove().direct()
    }
  }

  // this must be called after master is set
  orm.on('setUpNewMaster', async function (isMaster) {
    if (isMaster)
      await removeFake()
    else
      await removeAll()
    const highestCommitId = (await orm('Commit').findOne({}).sort('-id') || {id: 0}).id;
    await orm('CommitData').updateOne({}, { highestCommitId }, { upsert: true })
    await orm.emit('transport:removeQueue')
    await orm.emit('commit:remove-all-recovery')
  })

  // if (isMaster) {
  //   //use only for master
  //
  //   orm.on('update:Commit:c', async function (commit) {
  //     let query = getQuery(commit);
  //     if (commit.dbName) query.name += `@${commit.dbName}`;
  //     const result = await orm.execChain(query);
  //     orm.emit(`commit:result:${commit.uuid}`, result);
  //     await orm.emit('master:transport:sync', commit.id);
  //   })
  //
  //   orm.on('commit:sync:master', async function (clientHighestId, dbName) {
  //     this.value = await orm('Commit', dbName).find({id: {$gt: clientHighestId}});
  //   })
  // }

  orm.emit('initFakeLayer');
}

module.exports = syncPlugin;
