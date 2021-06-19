const QUEUE_COMMIT_MODEL = 'QueueCommit'
const SENT_TIMEOUT = 10000
const MAX_TIMEOUT = 60000
const AwaitLock = require('await-lock').default
const dayjs = require('dayjs')

module.exports = function (orm) {
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
		await orm(QUEUE_COMMIT_MODEL).deleteMany({})
	})
	// This must run outside initSyncForClient hook because
	// hook commit must be written into queue db first
	orm.onQueue('transport:toMaster', async (commit) => {
		await orm(QUEUE_COMMIT_MODEL).create({
			commit,
			dateAdded: new Date()
		})
		if (!orm.getQueue('queue:send').length)
			orm.emit('queue:send')
	})

	orm.onQueue('transport:finish:send', async function (_queueCommit) {
		const removedCommitUUID = _queueCommit.map((commit) => {
			if (!commit.uuid)
				console.error('Commit uuid is null')
			return commit.uuid
		})
		await orm(QUEUE_COMMIT_MODEL).deleteMany({ 'commit.uuid': { $in: removedCommitUUID } })
	})

	async function tryResend() {
		const remainCommit = await orm(QUEUE_COMMIT_MODEL).count()
		if (!orm.isMaster() && remainCommit && !orm.getQueue('queue:send').length) {
			console.log('Retry sending commit !', dayjs().toDate())
			orm.emit('queue:send')
		}
		lockSend.acquired && lockSend.release()
	}
	setInterval(() => {
		tryResend()
	}, 10000)

	orm.onQueue('queue:send', async function () {
		console.log('Try to send to master')

		async function doSend() {
			const data = await orm(QUEUE_COMMIT_MODEL).find()
			await orm.emit('transport:send', data.map(item => item.commit))
		}

		const remainCommit = await orm(QUEUE_COMMIT_MODEL).count()
		if (remainCommit) {
			await new Promise(async (resolve, reject) => {
				try {
					setTimeout(() => resolve(), 10000)
					await doSend()
					resolve()
				} catch (e) {
					reject(e)
				}
			})
		}
	})

	clearQueue()
}
