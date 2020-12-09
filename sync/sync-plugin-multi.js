const _ = require('lodash');
const uuid = require('uuid').v1;
let AwaitLock = require('await-lock').default;

const syncPlugin = function (orm, role) {
  const isMaster = role === 'master';
  orm.isMaster = () => isMaster;
  const whitelist = []

  orm.registerCommitBaseCollection = function () {
    whitelist.push(...arguments);
  }

  orm.on('pre:execChain', -1, function (query) {
    const last = _.last(query.chain);
    if (last.fn === "direct") {
      query.chain.pop();
      this.stop();
    } else {
      if (whitelist.includes(query.name)) {
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
        collectionName: query.name,
        uuid: uuid(),
        tags: args.filter(arg => typeof arg === "string"),
        data: _.assign({}, ...args.filter(arg => typeof arg === "object")),
        chain: JSON.stringify(_chain),
        approved: false
      };

      orm.once(`proxyPreReturnValue:${query.uuid}`, async function (_query, target, exec) {
        if (_.get(_query, "chain[0].args[0]._id")) {
          orm.emit(`commit:auto-assign`, commit, _query, target);
          orm.emit(`commit:auto-assign:${_query.name}`, commit, _query, target);
          commit.data.docId = _.get(_query, "chain[0].args[0]._id");
        }
        let value;
        if (!isMaster) {
          const {value: _commit} = await orm.emit('createCommit:master', _.cloneDeep(commit));
          if (_commit.chain !== commit.chain) {
            exec = async () => await orm.execChain(getQuery(commit))
          }
          await orm.emit('commit:build-fake', _query, target, exec, _commit, e => eval(e));
        }
        let lock = new AwaitLock();
        if (isMaster) {
          lock.acquireAsync();
          orm.once(`commit:result:master:${commit.uuid}`, function (result) {
            value = result;
            lock.release();
          });
        }
        orm.emit("toMaster", commit, _query);
        if (isMaster) {
          await lock.acquireAsync();
        }
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
        }
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

      for (const recovery of recoveries) {
        if (recovery.type === 'create') {
          await orm(recovery.collectionName).remove({_id: recovery.doc._id}).direct();
        } else {
          await orm(recovery.collectionName).create(recovery.doc).direct();
        }
      }
      await orm('Recovery').remove({uuid: commit.uuid});
    });
  })

  //should transparent
  orm.on(`commit:requireSync`, async function () {
    const {value: highestId} = await orm.emit('getHighestCommitId');
    orm.emit('commit:sync', highestId);
  });
  orm.on('getHighestCommitId', async function (dbName) {
    const {id: highestCommitId} = await orm('Commit', dbName).findOne({}).sort('-id') || {id: 0};
    this.value = highestCommitId;
  })

  //should transparent
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
  })

  //customize
  orm.onQueue('commit:handler', async commit => {
    await orm.emit('commit:remove-fake', commit);
    await orm.execChain(getQuery(commit));
  })

  //customize
  orm.onDefault('createCommit:master', async function (commit) {
    let {value: highestId} = await orm.emit('getHighestCommitId', commit.dbName);
    highestId++;
    commit.approved = true;
    commit.id = highestId;
    this.value = commit;
    if (isMaster) {
      this.value = await orm(`Commit`, commit.dbName).create(commit);
    }
  })

  if (isMaster) {
    //use only for master

    orm.on('update:Commit:c', async function (commit) {
      let query = getQuery(commit);
      if (commit.dbName) query.name += `@${commit.dbName}`;
      const result = await orm.execChain(query);
      if (commit.fromMaster) {
        orm.emit(`commit:result:master:${commit.uuid}`, result);
      }
      await orm.emit('master:commit:requireSync');
    })

    orm.on('commit:sync:master', async function (clientHighestId, dbName) {
      this.value = await orm('Commit', dbName).find({id: {$gt: clientHighestId}});
    })
  }

  //todo: layer transport implement
  orm.on('initSyncForClient', clientSocket => {
    orm.onQueue('toMaster', async commit => {
      clientSocket.emit('commitRequest', commit)
    })

    clientSocket.on('commit:requireSync', async () => {
      orm.emit('commit:requireSync');
    })

    orm.on('commit:sync', (highestId) => {
      const args = [highestId];
      orm.emit('commit:sync:args', args);
      clientSocket.emit('commit:sync', args, async (commits) => {
        await orm.emit('commit:sync:callback', commits)
      })
    })
  })

  orm.on('initSyncForMaster', masterIo => {
    masterIo.on('commitRequest', async (commit) => {
      await orm.emit('createCommit:master', commit);
    });

    orm.on('master:commit:requireSync', () => {
      masterIo.emit(`commit:requireSync`);
    });

    masterIo.on('commit:sync', async function ([clientHighestId = 0, dbName], cb) {
      const {value: commits} = await orm.emit('commit:sync:master', clientHighestId, dbName);
      cb(commits);
    })

    orm.on('toMaster', async commit => {
      commit.fromMaster = true;
      await orm.emit('createCommit:master', commit);
    });
  })

  orm.on('initSyncForCloud', cloudIo => {
    cloudIo.on('commit:requireSync', highestId => {
    })
  })

  orm.emit('initFakeLayer');
}

module.exports = syncPlugin;
