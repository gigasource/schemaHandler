const AwaitLock = require('await-lock').default;

module.exports = function (orm) {
  //todo: layer transport implement
  orm.on('initSyncForClient', (clientSocket, dbName) => {
    orm.onQueue('transport:toMaster', async commit => {
      clientSocket.emit('commitRequest', commit)
    })

    clientSocket.on('transport:sync', async () => {
      // orm.emit('transport:sync');
      const {value: highestId} = await orm.emit('getHighestCommitId');
      orm.emit('transport:require-sync', highestId);
    })

    orm.onQueue('transport:require-sync', (highestId) => {
      const args = [highestId];
      orm.emit('commit:sync:args', args);
      clientSocket.emit('transport:require-sync', args, async (commits) => {
        await orm.emit('transport:requireSync:callback', commits)
      })
    })
  })

  orm.on('initSyncForMaster', socket => {
    orm.on('master:transport:sync', (id) => {
      socket.emit(`transport:sync`);
    });

    socket.on('commitRequest', async (commit) => {
      await orm.emit('commitRequest', commit);
    });

    socket.on('transport:require-sync', async function ([clientHighestId = 0, dbName], cb) {
      const {value: commits} = await orm.emit('commit:sync:master', clientHighestId, dbName);
      cb(commits);
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
