const AwaitLock = require('await-lock').default;

module.exports = function (orm) {
  //todo: layer transport implement
  orm.on('initSyncForClient', (clientSocket, dbName) => {
    const transportToMaster = async (commit, _dbName) => {
      if (dbName !== _dbName) return
      clientSocket.emit('commitRequest', commit)
    }
    const transportSync = async (_dbName) => {
      // orm.emit('transport:sync');
      if (dbName !== _dbName) return
      const {value: highestId} = await orm.emit('getHighestCommitId');
      orm.emit('transport:require-sync', highestId);
    }
    const transportRequireSync = (highestId, _dbName) => {
      if (dbName !== _dbName) return
      const args = [highestId];
      orm.emit('commit:sync:args', args);
      clientSocket.emit('transport:require-sync', args, async (commits) => {
        commits.forEach(commit => commit.dbName = dbName)
        await orm.emit('transport:requireSync:callback', commits)
      })
    }

    orm.onQueue('transport:toMaster', transportToMaster)
    clientSocket.on('transport:sync', transportSync)
    orm.onQueue('transport:require-sync', transportRequireSync)

    orm.on('offClient', (_dbName) => {
      if (dbName !== _dbName) return
      orm.off('transport:toMaster', transportToMaster)
      clientSocket.off('transport:sync', transportSync)
      orm.off('transport:require-sync', transportRequireSync)
    })
  })

  orm.on('initSyncForMaster', (socket, dbName) => {
    const transportSync = (id, _dbName) => {
      if (dbName !== _dbName) return
      socket.emit('transport:sync')
    }
    const commitRequest = async (commit) => {
      commit.dbName = dbName
      await orm.emit('commitRequest', commit);
    }
    const transportRequireSync = async function ([clientHighestId = 0], cb) {
      const {value: commits} = await orm.emit('commit:sync:master', clientHighestId, dbName);
      cb(commits);
    }

    orm.on('master:transport:sync', transportSync);
    socket.on('commitRequest', commitRequest);
    socket.on('transport:require-sync', transportRequireSync);

    orm.on('offMaster', (_dbName) => {
      if (dbName !== _dbName) return
      orm.off('master:transport:sync', transportSync)
      socket.off('commitRequest', commitRequest)
      socket.off('transport:require-sync', transportRequireSync)
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
