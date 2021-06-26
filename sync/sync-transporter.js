const AwaitLock = require('await-lock').default;
const _ = require('lodash')
const { v1 } = require('uuid')

module.exports = function (orm) {
  const connectedClientSocket = {}
  const connectedMasterSocket = {}

  orm.on('initSyncForClient', function (clientSocket, dbName) {
    if (connectedClientSocket[clientSocket.id])
      return
    connectedClientSocket[clientSocket.id] = true

    const off1 = orm.on('transport:send', async (_dbName, queueCommit) => {
      if (!queueCommit)
        queueCommit = _dbName
      if (!queueCommit || !queueCommit.length)
        return
      await new Promise(resolve => {
        console.log('commitRequest', queueCommit.length, queueCommit[0]._id, new Date())
        clientSocket.emit('commitRequest', queueCommit, () => {
          orm.emit('transport:finish:send', queueCommit)
          resolve(queueCommit)
        })
      })
    }).off

    const throttleRequireSync = _.throttle(() => {
      orm.emit('transport:require-sync');
    }, 300, { trailing: true })

    clientSocket.on('transport:sync',  async () => {
      throttleRequireSync()
    })

    clientSocket.on('transport:sync:progress', async (_dbName, cb) => {
      if (_dbName !== dbName) {
        cb(null, null)
        return
      }
      const commitData = await orm('CommitData').findOne()
      // listen to this hook in your app to get your own id
      const clientId = orm.emit('transport:getDeviceClientId')
      cb(clientId, commitData && commitData.highestCommitId ? commitData.highestCommitId : 0)
    })

    const off2 = orm.onQueue('transport:require-sync', async () => {
      const {value: highestId} = await orm.emit('getHighestCommitId', dbName)
      const args = [highestId];
      orm.emit('commit:sync:args', args);
      await new Promise((resolve) => {
        const wait = setTimeout(() => {
          resolve()
        }, 10000)
        clientSocket.emit('transport:require-sync', args, async (commits, needSync) => {
          clearTimeout(wait)
          throttleRequireSync.cancel()
          commits.forEach(commit => commit.dbName = dbName)
          await orm.emit('transport:requireSync:callback', commits)
          // clear all queued require sync commands because all "possible" commits is synced
          if (needSync && !orm.getQueue('transport:require-sync').length)
            orm.emit('transport:require-sync')
          resolve()
        })
      })
    }).off

    const off3 = orm.on('health-check', async function () {
      let hasDone = false
      await new Promise(resolve => {
        const wait = setTimeout(() => {
          hasDone = true
        }, 5000)
        clientSocket.emit('transport:health-check', () => {
          if (hasDone) return
          clearTimeout(wait)
          orm.emit('health-check-done')
          this.stop()
          resolve()
        })
      })
    }).off

    function closeAllConnection() {
      delete connectedClientSocket[clientSocket.id]
      off1 && off1()
      off2 && off2()
      off3 && off3()
      clientSocket.removeAllListeners('transport:sync');
      clientSocket.removeAllListeners('transport:sync:progress')
    }

    orm.on('offClient', (_dbName) => {
      if (dbName !== _dbName) return
      closeAllConnection()
    })
  })
  orm.on('reset-session', async function () {
    await orm('CommitData').updateOne({}, { sessionId: v1() }, { upsert: true })
  })

  async function doSessionCheck(socket) {
    const commitData = await orm('CommitData').findOne()
    socket.emit('session-check', commitData ? commitData.sessionId : null)
  }

  orm.onQueue('initSyncForMaster', (socket, dbName) => {
    if (connectedMasterSocket[socket.id])
      return
    connectedMasterSocket[socket.id] = true

    const debounceTransportSync = _.debounce(() => {
      socket.emit('transport:sync')
    }, 300)

    const off1 = orm.on('master:transport:sync', (id, _dbName) => {
      if (dbName !== _dbName) return
      debounceTransportSync()
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

    socket.on('transport:require-sync', async function ([clientHighestId = 0], cb) {
      let commits = (await orm.emit('transport:require-sync:preProcess', clientHighestId, cb)).value
      if (!commits || !Array.isArray(commits))
        commits = []
      commits.push(...(await orm.emit('commit:sync:master', clientHighestId, dbName)).value)
      // const {value: commits} = await orm.emit('commit:sync:master', clientHighestId, dbName);
      const commitData = await orm('CommitData').findOne({})
      const highestCommitId = (commitData && commitData.highestCommitId) ? commitData.highestCommitId : 0
      const needSync = (clientHighestId + commits.length < highestCommitId)
      cb(commits, needSync);
    });

    socket.on('transport:health-check', (cb) => {
      cb()
    })

    function closeAllConnection() {
      delete connectedMasterSocket[socket.id]
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
