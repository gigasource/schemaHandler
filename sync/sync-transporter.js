const AwaitLock = require('await-lock').default;
const QUEUE_COMMIT_MODEL = 'QueueCommit'
const SENT_TIMEOUT = 10000
const MAX_TIMEOUT = 60000
const _ = require('lodash')

let queueCommit = []

module.exports = function (orm) {
  orm.on('transport:loadQueueCommit', async function () {
    queueCommit = (await orm(QUEUE_COMMIT_MODEL).find({})).map(commit => {
      return commit.commit
    })
  })
  orm.on('transport:removeQueue', async function () {
    queueCommit = []
    await orm(QUEUE_COMMIT_MODEL).remove({})
  })
  // This must run outside initSyncForClient hook because
  // hook commit must be written into queue db first
  orm.onQueue('transport:toMaster', async (commit, _dbName) => {
    await orm(QUEUE_COMMIT_MODEL).create({
      commit,
      dbName: _dbName
    })
    queueCommit.push(commit)
    orm.emit('transport:send', _dbName)
  })

  orm.on('initSyncForClient', (clientSocket, dbName) => {
    const lockSend = new AwaitLock()
    const off1 = orm.on('transport:send', async (_dbName) => {
      if (lockSend.acquired) return
      lockSend.tryAcquire()
      if (dbName !== _dbName) return
      let sent = false
      let currentTimeout = 0

      const send = function () {
        currentTimeout += SENT_TIMEOUT
        currentTimeout = Math.min(currentTimeout, MAX_TIMEOUT)
        setTimeout(() => {
          if (!sent && !orm.getMaster(_dbName)) {
            console.log('Retry sending commit !')
            send()
          }
        }, currentTimeout)
        const sentCommits = _.cloneDeep(queueCommit)
        clientSocket.emit('commitRequest', sentCommits, async () => {
          sent = true
          _.remove(queueCommit, commit => !!sentCommits.find(_commit => _commit.uuid === commit.uuid))
          const removedCommitUUID = sentCommits.map(commit => commit.uuid)
          await orm(QUEUE_COMMIT_MODEL).remove({ 'commit.uuid': { $in: removedCommitUUID } })
          lockSend.acquired && lockSend.release()
          orm.emit('transport:send')
        })
      }
      if (queueCommit.length)
        send()
      else
        lockSend.acquired && lockSend.release()
    }).off

    clientSocket.on('transport:sync',  async () => {
      orm.emit('transport:require-sync');
    })

    const off2 = orm.onQueue('transport:require-sync', async () => {
      const {value: highestId} = await orm.emit('getHighestCommitId', dbName)
      const args = [highestId];
      orm.emit('commit:sync:args', args);
      await new Promise((resolve) => {
        const wait = setTimeout(() => {
          resolve()
        }, 10000)
        clientSocket.emit('transport:require-sync', args, async (commits) => {
          clearTimeout(wait)
          commits.forEach(commit => commit.dbName = dbName)
          await orm.emit('transport:requireSync:callback', commits)
          resolve()
        })
      })
    }).off

    orm.on('offClient', (_dbName) => {
      if (dbName !== _dbName) return
      off1()
      off2()
      clientSocket.removeAllListeners('transport:sync');
    })

    orm.emit('transport:send')
  })

  orm.on('initSyncForMaster', (socket, dbName) => {
    const off1 = orm.on('master:transport:sync', (id, _dbName) => {
      if (dbName !== _dbName) return
      socket.emit('transport:sync')
    }).off;

    socket.on('commitRequest', async (commits, cb) => {
      for (let commit of commits) {
        commit.dbName = dbName
        await orm.emit('commitRequest', commit);
      }
      cb && cb()
    });

    socket.on('transport:require-sync', async function ([clientHighestId = 0], cb) {
      const {value: commits} = await orm.emit('commit:sync:master', clientHighestId, dbName);
      cb(commits);
    });

    orm.on('offMaster', (_dbName) => {
      if (dbName !== _dbName) return
      off1()
      socket.removeAllListeners('commitRequest')
      socket.removeAllListeners('transport:require-sync')
    })
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
