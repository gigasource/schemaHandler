const AwaitLock = require('await-lock').default;
const _ = require('lodash')
const { v1 } = require('uuid')

module.exports = function (orm) {

  orm.on('initSyncForClient', function (clientSocket, dbName) {
    orm.emit('transporter:destroy:default')

    const off1 = orm.on('transport:send', async (_dbName, queueCommit) => {
      if (!queueCommit)
        queueCommit = _dbName
      if (!queueCommit || !queueCommit.length)
        return
      await new Promise(resolve => {
        console.log('commitRequest', queueCommit.length, queueCommit[0]._id, new Date())
        clientSocket.emit('commitRequest', queueCommit, async () => {
          await orm.emit('transport:finish:send', queueCommit)
          resolve(queueCommit)
        })
      })
    }).off

    const debounceRequireSync = _.debounce(async (masterHighestId) => {
      const commitData = await orm('CommitData').findOne()
      if (commitData && masterHighestId <= commitData.highestCommitId)
        return
      orm.emit('transport:require-sync');
    }, 300, { trailing: true })

    clientSocket.on('transport:sync',  async (masterHighestId) => {
      debounceRequireSync(masterHighestId)
    })

    clientSocket.on('transport:sync:progress', async (_dbName, cb) => {
      if (_dbName !== dbName) {
        cb(null, null)
        return
      }
      const commitData = await orm('CommitData', dbName).findOne()
      // listen to this hook in your app to get your own id
      const clientId = orm.emit('transport:getDeviceClientId')
      cb(clientId, commitData && commitData.highestCommitId ? commitData.highestCommitId : 0)
    })

    const off2 = orm.onQueue('transport:require-sync', async function () {
      console.log('[Require sync]')
      const {value: highestId} = await orm.emit('getHighestCommitId', dbName)
      const {value: highestArchiveId} = await orm.emit('getHighestArchiveId', dbName)
      const args = [highestId, highestArchiveId];
      orm.emit('commit:sync:args', args);
      this.value = await new Promise((resolve) => {
        const wait = setTimeout(() => {
          resolve(false)
        }, 10000)
        clientSocket.emit('transport:require-sync', args, async (commits, needSync, masterHighestId) => {
          clearTimeout(wait)
          console.log('Received', commits.length, commits.length ? commits[0]._id : '', needSync)
          if (masterHighestId)
            await orm('CommitData').updateOne({}, { masterHighestId })
          await orm('CommitData').updateOne({}, {
            lastTimeSyncWithMaster: new Date()
          })
          commits.forEach(commit => commit.dbName = dbName)
          await orm.emit('transport:requireSync:callback', commits)
          // clear all queued require sync commands because all "possible" commits is synced
          if (needSync)
            debounceRequireSync()
          resolve(true)
        })
      })
    }).off

    const off3 = orm.on('health-check', async function () {
      let hasDone = false
      await new Promise(resolve => {
        const wait = setTimeout(() => {
          console.log('[HealthCheck] Socket to master timeout')
          orm.emit('commit:report:health-check', 'lanTransporter', 'disconnected', new Date())
          hasDone = true
          resolve()
        }, 5000)
        clientSocket.emit('transport:health-check', () => {
          if (hasDone) return
          orm.emit('commit:report:health-check', 'lanTransporter', 'connected', new Date())
          clearTimeout(wait)
          orm.emit('health-check-done')
          this.stop()
          resolve()
        })
      })
    }).off

    function closeAllConnection() {
      off1 && off1()
      off2 && off2()
      off3 && off3()
      clientSocket.removeAllListeners('transport:sync');
      clientSocket.removeAllListeners('transport:sync:progress')
    }

    orm.on('transporter:destroy:default', () => {
      closeAllConnection()
    })

    orm.on('offClient', (_dbName) => {
      if (dbName !== _dbName) return
      closeAllConnection()
    })

    clientSocket.on('connection-established', () => {
      debounceRequireSync()
    })

    debounceRequireSync()
    this.value = {
      closeAllConnection
    }
  })
  /*------Non server only-------*/
  orm.on('reset-session', async function () {
    await orm('CommitData').updateOne({}, { sessionId: v1() }, { upsert: true })
  })

  async function doSessionCheck(socket) {
    const commitData = await orm('CommitData').findOne()
    socket.emit('session-check', commitData ? commitData.sessionId : undefined)
  }
  /*----------------------------*/

  orm.onQueue('initSyncForMaster', function (socket, dbName) {
    const debounceTransportSync = _.debounce(async (id) => {
      const commitData = await orm('CommitData').findOne()
      socket.emit('transport:sync', Math.max(id, commitData ? commitData.highestCommitId : 0))
    }, 500)

    const off1 = orm.on('master:transport:sync', (id, _dbName) => {
      if (dbName !== _dbName) return
      debounceTransportSync(id)
    }).off;

    const off2 = orm.on('transport:checkProgress', async (cb) => {
      const list = []
      socket.emit('transport:sync:progress', (deviceClientId, highestCommitId) => {
        list.push({
          deviceClientId,
          highestCommitId
        })
      })
      setTimeout(() => {
        cb(list)
      }, 10000)
    }).off()

    socket.on('commitRequest', (commits, cb) => {
      cb && cb()
      console.log('commitRequest', commits.length, commits[0]._id, new Date())
      for (let commit of commits) {
        commit.dbName = dbName
      }
      orm.emit('commitRequest', commits);
    });

    socket.on('transport:require-sync', async function ([clientHighestId = 0, clientHighestArchiveId = 0], cb) {
      let commits = (await orm.emit('transport:require-sync:preProcess', clientHighestId)).value
      if (!commits || !Array.isArray(commits))
        commits = []
      clientHighestId = Math.max(clientHighestId, commits.length ? _.last(commits).id : 0)
      const commitsNeedToSync = (await orm.emit('commit:sync:master', clientHighestId, clientHighestArchiveId, dbName)).value
      commitsNeedToSync && commitsNeedToSync.length && commits.push(...commitsNeedToSync)
      // const {value: commits} = await orm.emit('commit:sync:master', clientHighestId, dbName);
      const commitData = await orm('CommitData', dbName).findOne({})
      const highestCommitId = (commitData && commitData.highestCommitId) ? commitData.highestCommitId : 0
      const needSync = commits.length > 0
      await orm.emit('transport:require-sync:postProcess', commits)
      cb(commits, needSync, highestCommitId);
    });

    socket.on('transport:health-check', (cb) => {
      cb()
    })

    function closeAllConnection() {
      off1 && off1()
      off2 && off2()
      socket.removeAllListeners('commitRequest')
      socket.removeAllListeners('transport:require-sync')
    }

    orm.on('offMaster', (_dbName) => {
      if (dbName !== _dbName) return
      closeAllConnection()
    })

    doSessionCheck(socket).then(r => r)
    this.value = {
      closeAllConnection
    }
  })

  // end of health check
  orm.on('health-check', 1, async function () {
    orm.emit('health-check-failed')
  })

  orm.on('initSyncForMasterIo', io => {
    io.on('connect', socket => {
      orm.emit('initSyncForMaster', socket);
    })
  })

  orm.on('initSyncForCloud', cloudIo => {
    cloudIo.on('transport:sync', highestId => {
    })
  })
}
