module.exports = function (orm) {
  const debug = orm.debug.extend('sync:replay')
  let playMode = null

  const PLAYING_MODE = 'playing'

  orm.playSync = playSync
  orm.setUpServerSocket = setUpServerSocket

  orm.getPlayMode = function () {
    return playMode
  }

  orm.startPlayMode = function () {
    playMode = PLAYING_MODE
  }

  // todo support keep playing
  let clientLock = false
  async function playSync(socket, toCommitId, keepPlaying = true) {
    if (clientLock) return
    clientLock = true
    orm.emit('offMaster')
    orm.emit('offClient')
    orm.emit('commit:flow:setMaster', false)
    orm.emit('transport:removeQueue')
    if (!keepPlaying) {
      await orm('ReplayedCommit').deleteMany()
      await orm('Commit').deleteMany()
      await orm('CommitData').updateOne({}, { highestCommitId: 0 }, { upsert: true })
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
            debug('Failed to replay, please restart and play again !')
          }, 10000)
        }, 60000)
        socket.emit('transport:require-sync', args, async (commits, needSync) => {
          clearTimeout(wait)
          debug('Received', commits.length, commits.length ? commits[0]._id : '', needSync)

          if (commits.length)
            await orm('ReplayedCommit').create(commits)

          await orm.emit('transport:requireSync:callback', commits)
          if (needSync) {
            orm.emit('transport:require-sync')
          } else {
            clientLock = false
            off()
            orm.emit('commit:flow:setMaster', true)
            const result = await orm.db.collection('replayedcommits').rename('commits', { dropTarget: true })
            playMode = null // done
            orm.emit('commit:replay:done')
          }
          resolve()
        })
      })
    }).off
    orm.emit('initSyncForClient', socket)
    orm.emit('transport:require-sync')
  }

  async function setUpServerSocket(socket, dbName, toCommitId) {
    socket.on('transport:require-sync', async (clientHighestId, cb) => {
      const commits = await orm('Commit', dbName).find({ id: { $gt: clientHighestId, $lte: toCommitId } }).limit(5000)
      const needSync = commits.length < 5000

      cb(commits, needSync)
      if (!needSync) {
        socket.removeListener('transport:require-sync')
      }
    })
  }
}
