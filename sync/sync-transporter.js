const AwaitLock = require('await-lock').default;
const QUEUE_COMMIT_MODEL = 'QueueCommit'
const SENT_TIMEOUT = 10000
const MAX_TIMEOUT = 60000
const _ = require('lodash')

let queueCommit = []

module.exports = function (orm) {
  orm.on('transport:loadQueueCommit', async function () {
    queueCommit = await orm(QUEUE_COMMIT_MODEL).find({})
    queueCommit.forEach(commit => {
      commit = commit.commit
    })
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
    const off1 = orm.on('transport:send', async (_dbName) => {
      if (dbName !== _dbName) return
      let sent = false
      let currentTimeout = 0

      const send = function () {
        currentTimeout += SENT_TIMEOUT
        currentTimeout = Math.min(currentTimeout, MAX_TIMEOUT)
        setTimeout(() => {
          if (!sent) {
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
          orm.emit('transport:send')
        })
      }
      if (queueCommit.length)
        send()
    }).off

    clientSocket.on('transport:sync',  async () => {
      const {value: highestId} = await orm.emit('getHighestCommitId', dbName);
      orm.emit('transport:require-sync', highestId);
    })

    const off2 = orm.onQueue('transport:require-sync', (highestId) => {
      const args = [highestId];
      orm.emit('commit:sync:args', args);
      clientSocket.emit('transport:require-sync', args, async (commits) => {
        commits.forEach(commit => commit.dbName = dbName)
        await orm.emit('transport:requireSync:callback', commits)
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
