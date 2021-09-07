const QUEUE_COMMIT_MODEL = 'QueueCommit'
const dayjs = require('dayjs')
const _ = require('lodash')

module.exports = function (orm) {
	const clearQueue = async () => {
		if (orm.isMaster && orm.isMaster()) {
			clearInterval(intervalClearQueue)
			return
		}
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
		clearInterval(tryResendInterval)
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
		if (orm.isMaster()) {
			clearInterval(tryResendInterval)
			return
		}
		const remainCommit = await orm(QUEUE_COMMIT_MODEL).count()
		if (remainCommit && !orm.getQueue('queue:send').length) {
			console.log('Retry sending commit !', dayjs().toDate())
			orm.emit('queue:send')
		}
	}
	const tryResendInterval = setInterval(() => {
		tryResend()
	}, 10000)

	const doSend = async () => {
		console.log('Try to send to master')
		const data = await orm(QUEUE_COMMIT_MODEL).find()
		await orm.emit('transport:send', data.map(item => item.commit))
	}

	orm.onQueue('queue:send', async function () {
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
