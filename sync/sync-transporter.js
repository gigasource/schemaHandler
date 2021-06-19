const AwaitLock = require('await-lock').default;
const _ = require('lodash')
const { v1 } = require('uuid')

module.exports = function (orm) {
  orm.on('initSyncForClient', (clientSocket, dbName) => {
    const off1 = orm.on('transport:send', async (_dbName, queueCommit) => {
      if (!queueCommit)
        queueCommit = _dbName
      if (!queueCommit || !queueCommit.length)
        return
      await new Promise(resolve => {
        clientSocket.emit('commitRequest', queueCommit, () => {
          orm.emit('transport:finish:send', queueCommit)
          resolve(queueCommit)
        })
      })
    })

    clientSocket.on('transport:sync',  async () => {
      orm.emit('transport:require-sync');
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
          commits.forEach(commit => commit.dbName = dbName)
          await orm.emit('transport:requireSync:callback', commits)
          if (needSync && !orm.getQueue('transport:require-sync').length)
            orm.emit('transport:require-sync')
          resolve()
        })
      })
    }).off

    const off3 = orm.onQueue('health-check', async () => {
      let hasDone = false
      await new Promise(resolve => {
        const wait = setTimeout(() => {
          hasDone = true
          resolve()
        }, 5000)
        clientSocket.emit('transport:health-check', () => {
          if (hasDone) return
          clearTimeout(wait)
          orm.emit('health-check-done')
          orm.getQueue('health-check').end()
          resolve()
        })
      })
    }).off

    orm.on('offClient', (_dbName) => {
      if (dbName !== _dbName) return
      off1()
      off2()
      off3()
      clientSocket.removeAllListeners('transport:sync');
      clientSocket.removeAllListeners('transport:sync:progress')
    })

    orm.emit('transport:send')
  })
  orm.on('reset-session', async function () {
    await orm('CommitData').updateOne({}, { sessionId: v1() }, { upsert: true })
  })

  async function doSessionCheck(socket) {
    const commitData = await orm('CommitData').findOne()
    socket.emit('session-check', commitData ? commitData.sessionId : null)
  }

  orm.onQueue('initSyncForMaster', (socket, dbName) => {
    const off1 = orm.on('master:transport:sync', (id, _dbName) => {
      if (dbName !== _dbName) return
      socket.emit('transport:sync')
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

    socket.on('commitRequest', async (commits, cb) => {
      for (let commit of commits) {
        commit.dbName = dbName
        await orm.emit('commitRequest', commit);
      }
      cb && cb()
    });

    socket.on('transport:require-sync', async function ([clientHighestId = 0], cb) {
      const {value: commits} = await orm.emit('commit:sync:master', clientHighestId, dbName);
      const commitData = await orm('CommitData').findOne({})
      const highestCommitId = (commitData && commitData.highestCommitId) ? commitData.highestCommitId : 0
      const needSync = (clientHighestId + commits.length < highestCommitId)
      cb(commits, needSync);
    });

    socket.on('transport:health-check', (cb) => {
      cb()
    })

    orm.on('offMaster', (_dbName) => {
      if (dbName !== _dbName) return
      off1()
      off2()
      socket.removeAllListeners('commitRequest')
      socket.removeAllListeners('transport:require-sync')
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
