const AwaitLock = require('await-lock').default;
const _ = require('lodash');

module.exports = function (orm, role) {
  let masterDbMap = (orm.mode === 'multi' ? {} : false)

  orm.on('commit:flow:setMaster', function (_isMaster, dbName) {
    if (dbName) {
      masterDbMap[dbName] = _isMaster
    } else {
      masterDbMap = _isMaster
    }
  })

  const checkMaster = (dbName) => {
    if (role === 'master') return true;
    if (role === 'client') return false;
    if (!dbName) return false;
    return masterDbMap[dbName];
  }

  orm.isMaster = checkMaster

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
    if (value) delete value._fake;
    this.value = value
  })

  orm.on('update:Commit:c', async function (commit) {
    if (!commit.fromMaster && !checkMaster(commit.dbName)) {
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
