const AwaitLock = require('await-lock').default;

module.exports = function (orm) {
  //todo: layer transport implement
  orm.on('initSyncForClient', (clientSocket, dbName) => {
    const off1 = orm.onQueue('transport:toMaster', async (commit, _dbName) => {
      if (dbName !== _dbName) return
      clientSocket.emit('commitRequest', commit)
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
  })

  orm.on('initSyncForMaster', (socket, dbName) => {
    const off1 = orm.on('master:transport:sync', (id, _dbName) => {
      if (dbName !== _dbName) return
      socket.emit('transport:sync')
    }).off;

    socket.on('commitRequest', async (commit) => {
      commit.dbName = dbName
      await orm.emit('commitRequest', commit);
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
