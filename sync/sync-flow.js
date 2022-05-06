const AwaitLock = require('await-lock').default;
const _ = require('lodash');
const jsonFn = require('json-fn')
const { EVENT_CONSTANT } = require('./sync-log')

module.exports = function (orm, role) {
  let masterDbMap = (orm.mode === 'multi' ? {} : false)
  let COMMIT_LARGE_SYNC_THRESHOLD = 200

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
  })

  const checkMaster = (dbName) => {
    if (role === 'master') return true;
    if (role === 'client') return false;
    if (!dbName) return masterDbMap;
    return masterDbMap[dbName];
  }

  orm.isMaster = checkMaster

  // customize
  let fakeId = null
  orm.onQueue('commit:flow:execCommit', async function (query, target, exec, commit) {
    if (orm.mode === 'multi' && !commit.dbName) {
      console.warn('commit.dbName is undefined')
      return
    }
    //todo: [process:commit] can return array
    let _commit = _.cloneDeep(commit)
    orm.writeSyncLog(EVENT_CONSTANT.START_FLOW, commit)
    await orm.emit(`process:commit:${commit.collectionName}`, _commit, target)
    if (_commit.tags) {
      for (const tag of _commit.tags) {
        await orm.emit(`process:commit:${tag}`, _commit)
      }
    }
    commit = _commit;
    orm.writeSyncLog(EVENT_CONSTANT.AFTER_FIRST_PROCESS, commit)

    let value
    if (!checkMaster(commit.dbName)) {
      // client
      if (!fakeId) {
        const commitData = await orm('CommitData').findOne()
        fakeId = commitData && commitData.fakeId ? commitData.fakeId : 1
      }
      commit.fromClient = (await orm.emit('getCommitDataId')).value
      commit.createdDate = new Date()
      commit._fakeId = fakeId
      orm.writeSyncLog(EVENT_CONSTANT.SEND_TO_MASTER, commit._id)
      orm.emit('transport:toMaster', commit)
      fakeId += 1
      await orm('CommitData').updateOne({}, { fakeId })
      await orm.emit('commit:build-fake', query, target, commit, e => eval(e))
    } else {
      commit.fromMaster = true;
      const lock = new AwaitLock()
      await lock.acquireAsync()
      orm.writeSyncLog(EVENT_CONSTANT.START_EXECUTE, commit._id)
      orm.once(`commit:result:${commit._id.toString()}`, function (result) {
        value = result
        lock.release()
      })
      orm.emit('createCommit', commit)
      await lock.acquireAsync()
    }
    this.value = value
  })

  let isLargeSync = false
  let getProgressInterval = null
  let snapshotMilestone = null
  orm.onQueue('commit:handler:finish', async (commit) => {
    // end of commit's flow, delete all commits which have smaller id than this commit
    if (orm.mode !== 'multi' && !checkMaster()) {
      const commitData = await orm('CommitData').findOne()
      if (commitData && commitData.masterHighestId) {
        if (commitData.masterHighestId - commit.id > COMMIT_LARGE_SYNC_THRESHOLD) {
          if (!isLargeSync) {
            isLargeSync = true
            orm.emit('commit:largeSync', true)
            snapshotMilestone = (await orm.emit('getHighestCommitId')).value
            getProgressInterval = setInterval(async () => {
              const commitData = await orm('CommitData').findOne()
              const { value: currentHighestCommit } = await orm.emit('getHighestCommitId')
              const syncProgress = (currentHighestCommit - snapshotMilestone) / (parseInt(commitData.masterHighestId) - snapshotMilestone + 1) // prevent 0
              orm.emit('commit:largeSync:progress', syncProgress)
            }, 1000)
          }
        } else {
          if (isLargeSync) {
            isLargeSync = false
            orm.emit('commit:largeSync', false)
            clearInterval(getProgressInterval)
            getProgressInterval = null
          }
        }
      }
    }
  })

  orm.onQueue('update:Commit:c', 'fake-channel', async function (commit) {
    if (!commit.id) return
    orm.writeSyncLog(EVENT_CONSTANT.FLOW_EXEC, commit._id)
    if (!checkMaster(commit.dbName)) {
      await orm.emit('commit:update-fake', commit);
    }
    const run = !(await orm.emit(`commit:handler:shouldNotExecCommand:${commit.collectionName}`, commit));
    orm.writeSyncLog(EVENT_CONSTANT.FLOW_SHOULD_NOT_EXEC, commit._id + ' ' + run)
    let result
    if (run) {
      let query = orm.getQuery(commit)
      if (commit.dbName) query.name += `@${commit.dbName}`
      try {
        result = await orm.execChain(query)
      } catch (e) {
        orm.writeSyncLog(EVENT_CONSTANT.FLOW_EXEC_ERROR, commit._id + ' ' + e.message)
        console.error('Error on query', jsonFn.stringify(query), 'is', e)
        await orm.emit('commit:report:errorExec', commit.id, e.message)
      }
    }
    await orm('Commit').updateOne({ _id: commit._id }, { $unset: {isPending: ''} })
    orm.emit(`commit:result:${commit._id.toString()}`, result);
    orm.emit('master:transport:sync', commit.id, commit.dbName);
    orm.emit(`commit:handler:finish:${commit.collectionName}`, result, commit);
    orm.emit('commit:handler:finish', commit);
    await orm.emit('commit:handler:postProcess', commit)
  })
}
