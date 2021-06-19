const QUEUE_COMMIT_MODEL = 'QueueCommit'
const SENT_TIMEOUT = 10000
const MAX_TIMEOUT = 60000
const AwaitLock = require('await-lock').default
const dayjs = require('dayjs')

module.exports = function (orm) {
	const lockSend = new AwaitLock()

	const clearQueue = async () => {
		const clearDate = dayjs().subtract(1, 'hour').toDate()
		await orm(QUEUE_COMMIT_MODEL).deleteMany({
			dateAdded: { '$exists': false }
		})
		await orm(QUEUE_COMMIT_MODEL).deleteMany({
			dateAdded: { '$lte': clearDate }
		})
	}

	const intervalClearQueue = setInterval(clearQueue, 60 * 60 * 1000)

	orm.on('transport:removeQueue', async function () {
		clearInterval(intervalClearQueue)
		await orm(QUEUE_COMMIT_MODEL).remove({})
	})
	// This must run outside initSyncForClient hook because
	// hook commit must be written into queue db first
	orm.onQueue('transport:toMaster', async (commit) => {
		await orm(QUEUE_COMMIT_MODEL).create({
			commit,
			dateAdded: new Date()
		})
		send()
	})
	orm.onQueue('transport:finish:send', async function (_queueCommit) {
    const removedCommitUUID = _queueCommit.map(({ commit }) => {
    	if (!commit.uuid)
		    console.error('Commit uuid is null')
    	return commit.uuid
    })
    await orm(QUEUE_COMMIT_MODEL).remove({ 'commit.uuid': { $in: removedCommitUUID } })
		lockSend.acquired && lockSend.release()
		await send()
	})

	async function send() {
		if (lockSend.acquired) {
			console.log('Lock send is acquired', dayjs().toDate())
			return
		}
		let currentTimeout = 0

		async function doSend() {
			console.log('Try to send to master')
			currentTimeout += SENT_TIMEOUT
			currentTimeout = Math.min(currentTimeout, MAX_TIMEOUT)
			setTimeout(async () => {
				const remainCommit = await orm(QUEUE_COMMIT_MODEL).find()
	      if (!orm.isMaster() && remainCommit) {
	        console.log('Retry sending commit !', dayjs().toDate())
	        doSend()
	      }
			}, currentTimeout)
			const data = await orm(QUEUE_COMMIT_MODEL).find()
			orm.emit('transport:send', data)
		}

		const remainCommit = await orm(QUEUE_COMMIT_MODEL).find()
		if (remainCommit)
			doSend()
		else
			lockSend.acquired && lockSend.release()
	}

	clearQueue()
}
