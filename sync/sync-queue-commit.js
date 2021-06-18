let queueCommit = []
const QUEUE_COMMIT_MODEL = 'QueueCommit'
const SENT_TIMEOUT = 10000
const MAX_TIMEOUT = 60000

module.exports = function (orm) {
	const lockSend = new AwaitLock()

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
	orm.onQueue('transport:toMaster', async (commit) => {
		await orm(QUEUE_COMMIT_MODEL).create({
			commit
		})
		queueCommit.push(commit)
	})
	orm.on('transport:finish:send', async function (_queueCommit) {
    _.remove(queueCommit, commit => !!_queueCommit.find(_commit => _commit.uuid === commit.uuid))
    const removedCommitUUID = _queueCommit.map(commit => commit.uuid)
    await orm(QUEUE_COMMIT_MODEL).remove({ 'commit.uuid': { $in: removedCommitUUID } })
		lockSend.release()
		send()
	})

	async function send() {
		if (lockSend.acquired)
			return
		let currentTimeout = 0

		function doSend() {
			currentTimeout += SENT_TIMEOUT
			currentTimeout = Math.min(currentTimeout, MAX_TIMEOUT)
			setTimeout(() => {
	      if (!orm.isMaster()) {
	        console.log('Retry sending commit !')
	        send()
	      }
			}, currentTimeout)
			orm.emit('transport:send', _.cloneDeep(queueCommit))
		}

		if (queueCommit.length)
			doSend()
		else
			lockSend.release()
	}
}
