const AwaitLock = require('await-lock').default;
const _ = require('lodash');

module.exports = function (orm) {
  let isMaster = (orm.mode === 'multi' ? {} : false)

  orm.on('commit:flow:setMaster', function (_isMaster, dbName) {
    if (dbName) {
      isMaster[dbName] = _isMaster
    } else {
      isMaster = _isMaster
    }
  })

  const checkMaster = (dbName) => {
    return dbName ? isMaster[dbName] : isMaster
  }

  orm.isMaster = checkMaster

  // customize
  orm.onQueue('commit:flow:execCommit', async (query, target, exec, commit) => {
    if (orm.mode === 'multi' && !commit.dbName) {
      console.warn('commit.dbName is undefined')
      return
    }
    //todo: [process:commit] can return array
    const {value: _commit} = await orm.emit('process:commit', _.cloneDeep(commit))
    if (_commit && _commit.chain !== commit.chain) {
      exec = async () => await orm.execChain(getQuery(_commit))
      commit = _commit;
    }

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
    this.value = value
  })

  orm.on('update:Commit:c', async function (commit) {
    if (!commit.fromMaster) {
      await orm.emit('commit:remove-fake', commit);
    }
    let query = orm.getQuery(commit)
    if (commit.dbName) query.name += `@${commit.dbName}`
    const result = await orm.execChain(query)
    orm.emit(`commit:result:${commit.uuid}`, result);
    orm.emit('master:transport:sync', commit.id);
    orm.emit('commit:handler:finish');
  })
}
