const AwaitLock = require('await-lock').default;
const _ = require('lodash');

module.exports = function (orm, role) {
  let masterDbMap = (orm.mode === 'multi' ? {} : false)
  let unsavedCommitCollection = {}

  orm.on('commit:flow:setMaster', function (_isMaster, dbName) {
    // 0: same
    // 1: master -> node
    // 2: node -> master
    let isStateChange = 0
    if (dbName) {
      if (masterDbMap[dbName] !== _isMaster) {
        isStateChange = (_isMaster ? 2 : 1)
      }
      masterDbMap[dbName] = _isMaster
    } else {
      if (masterDbMap !== _isMaster) {
        isStateChange = (_isMaster ? 2 : 1)
      }
      masterDbMap = _isMaster
    }
    if (isStateChange === 2) {
      orm.emit('offNode')
    } else if (isStateChange === 1) {
      orm.emit('offMaster')
    }
    if (_isMaster) {
      orm.emit('commit:remove-all-recovery')
    }
  })

  orm.getMaster = (dbName) => {
    if (dbName) return masterDbMap[dbName]
    return masterDbMap
  }

  const checkMaster = (dbName) => {
    if (role === 'master') return true;
    if (role === 'client') return false;
    if (!dbName) return masterDbMap;
    return masterDbMap[dbName];
  }

  orm.isMaster = checkMaster

  orm.setUnsavedCommitCollection = (collection) => {
    unsavedCommitCollection[collection] = true
  }

  // customize
  orm.onQueue('commit:flow:execCommit', async function (query, target, exec, commit) {
    if (orm.mode === 'multi' && !commit.dbName) {
      console.warn('commit.dbName is undefined')
      return
    }
    //todo: [process:commit] can return array
    let _commit = _.cloneDeep(commit)
    if (!_commit.tags) {
      await orm.emit('process:commit', _commit)
    } else {
      for (const tag of _commit.tags) {
        await orm.emit(`process:commit:${tag}`, _commit)
      }
    }
    if (_commit && _commit.chain !== commit.chain) {
      exec = async () => await orm.execChain(orm.getQuery(_commit))
    }
    commit = _commit;

    let value
    if (!checkMaster(commit.dbName)) {
      // client
      orm.emit('transport:toMaster', commit)
      await orm.emit('commit:build-fake', query, target, exec, commit, e => eval(e))
    } else {
      commit.fromMaster = true;
      const lock = new AwaitLock()
      await lock.acquireAsync()
      orm.once(`commit:result:${commit.uuid}`, function (result) {
        value = result
        lock.release()
      })
      orm.emit('createCommit', commit)
      await lock.acquireAsync()
    }
    if (value) delete value._fake;
    this.value = value
  })

  orm.onQueue('commit:handler:finish', async (commit) => {
    // end of commit's flow, delete all commits which have smaller id than this commit
    if (!checkMaster(commit.dbName) && unsavedCommitCollection[commit.collectionName])
      await orm('Commit').deleteMany({ id: { $lt: commit.id }, collectionName: commit.collectionName })
  })

  orm.onQueue('update:Commit:c', 'fake-channel', async function (commit) {
    if (!checkMaster(commit.dbName)) {
      await orm.emit('commit:remove-fake', commit);
    }
    const run = !(await orm.emit(`commit:handler:shouldNotExecCommand:${commit.collectionName}`, commit));
    let result
    if (run) {
      let query = orm.getQuery(commit)
      if (commit.dbName) query.name += `@${commit.dbName}`
      result = await orm.execChain(query)
    }
    orm.emit(`commit:result:${commit.uuid}`, result);
    orm.emit('master:transport:sync', commit.id, commit.dbName);
    orm.emit(`commit:handler:finish:${commit.collectionName}`, result, commit);
    orm.emit('commit:handler:finish', commit);
  })
}
