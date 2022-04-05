const dayjs = require('dayjs')
const _ = require('lodash')

let deleteInterval = null
let off = null

module.exports = function (orm) {
  orm.startStoringCommits = startStoringCommits
  orm.stopStoringCommits = stopStoringCommits

  async function deleteCommitReplay() {
    const clearDate = dayjs().subtract(2, 'day').toDate()
    await orm('OldCommit').deleteMany({
      execDate: {
        $lte: clearDate
      }
    })
  }
  function startStoringCommits() {
    if (deleteInterval) return
    deleteInterval = setInterval(deleteCommitReplay, 8 * 60 * 60 * 1000) // 8 hours
    deleteCommitReplay().then()
    off = orm.on('commit:handler:finish', -5, async function (commit) {
      if (commit.chain && commit.execDate) {
        await orm('OldCommit').create(commit)
      }
    }).off
  }
  function stopStoringCommits() {
    if (!deleteInterval) return
    clearInterval(deleteInterval)
    deleteInterval = null
    off()
    off = null
    orm('OldCommit').deleteMany({}).then()
  }
}
