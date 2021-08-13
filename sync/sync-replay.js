module.exports = function (orm) {
  let playMode = null

  orm.playSync = playSync
  orm.setUpServerSocket = setUpServerSocket

  orm.getPlayMode = function() {
    return playMode
  }

  // todo support keep playing
  async function playSync(socket, toCommitId, keepPlaying = true) {
    orm.emit('offMaster')
    orm.emit('offClient')
    orm.emit('commit:flow:setMaster', false)
    if (!keepPlaying) {
      await orm('Commit').deleteMany()
      const whiteList = orm.getWhiteList()
      for (let collection of whiteList) {
        await orm(collection).deleteMany().direct()
        await orm('Recovery' + collection).deleteMany().direct()
      }
    }
    const off = orm.onQueue('transport:require-sync', async () => {
      const {value: highestId} = await orm.emit('getHighestCommitId', null)
      const args = highestId;
      await new Promise((resolve) => {
        const wait = setTimeout(() => {
          setInterval(() => {
            console.log('[CommitReplay] Failed to replay, please restart and play again !')
          }, 10000)
        }, 60000)
        socket.emit('transport:require-sync', args, async (commits, needSync) => {
          clearTimeout(wait)
          console.log('Received', commits.length, commits.length ? commits[0]._id : '', needSync)

          if (commits.length)
            await orm('CommitReplayed').create(commits)

          await orm.emit('transport:requireSync:callback', commits)
          // clear all queued require sync commands because all "possible" commits is synced
          if (needSync) {
            orm.emit('transport:require-sync')
          } else {
            off()
            orm.emit('commit:flow:setMaster', true)
            await orm('CommitPlayed').renameCollection('commits', true)
          }
          resolve()
        })
      })
    }).off
    orm.emit('initSyncForClient', socket)
    orm.emit('transport:require-sync')
  }

  async function setUpServerSocket(socket, dbName, toCommitId) {
    const off = socket.on('transport:require-sync', async (clientHighestId, cb) => {
      const commits = await orm('Commit', dbName).find({ id: { $gt: clientHighestId, $lte: toCommitId } }).limit(5000)
      const needSync = commits.length < 5000

      cb(commits, needSync)
      if (!needSync) {
        off()
      }
    }).off
  }
}
