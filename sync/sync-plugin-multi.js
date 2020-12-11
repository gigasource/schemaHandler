const _ = require('lodash');
const uuid = require('uuid').v1;

const syncPlugin = function (orm) {
  const whitelist = []

  orm.registerCommitBaseCollection = function () {
    whitelist.push(...arguments);
  }

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
        commit.condition = target.condition;
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
    const chain = JSON.parse(commit.chain || '[]');
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
        if (value) {
          value = await orm(query.name).updateOne(target.condition, {$set: {_fake: true}}).direct();
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

    orm.onQueue("commit:remove-fake", 'fake-channel', async function (commit) {
      //if (orm.name !== 'A') return;
      console.log('remove-fake');
      let recoveries = await orm('Recovery').find({uuid: commit.uuid});

      if (recoveries.length === 0) {
        const condition = _.mapKeys(commit.condition, (v, k) => `doc.${k}`)
        recoveries = await orm('Recovery').find(condition);
      }
      for (const recovery of recoveries) {
        await orm(recovery.collectionName).remove({_id: recovery.doc._id}).direct();
        if (recovery.type === 'create') {
        } else {
          await orm(recovery.collectionName).create(recovery.doc).direct();
        }
        await orm('Recovery').remove({_id: recovery._id});
      }

    });
  })

  //should transparent
  // orm.on(`transport:sync`, async function () {
  //   const {value: highestId} = await orm.emit('getHighestCommitId');
  //   orm.emit('transport:require-sync', highestId);
  // });
  orm.on('getHighestCommitId', async function (dbName) {
    const {id: highestCommitId} = await orm('Commit', dbName).findOne({}).sort('-id') || {id: 0};
    this.value = highestCommitId;
  })

  //should transparent
  orm.onQueue('transport:requireSync:callback', async function (commits) {
    for (const commit of commits) {
      //replace behaviour here
      await orm.emit('createCommit', commit)
    }
  })
  //customize
  orm.onDefault('createCommit', async function (commit) {
    if (!commit.id) {
      let {value: highestId} = await orm.emit('getHighestCommitId', commit.dbName);
      commit.id = highestId + 1;
    }
    try {
      this.value = await orm(`Commit`, commit.dbName).create(commit);
    } catch (e) {
      if (e.message.slice(0, 6) === 'E11000') {
        console.log('sync two fast')
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

  orm.onQueue('commitRequest', async function (commit) {
    const {value} = await orm.emit('process:commit', commit);
    if (value) {
      commit = value;
    }
    await orm.emit('createCommit', commit);
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
