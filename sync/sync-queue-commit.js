const QUEUE_COMMIT_MODEL = 'QueueCommit'
const dayjs = require('dayjs')
const _ = require('lodash')
const debug = require('debug')('sync:queue')
const error = require('debug')('sync:error:queue')

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
				error('Commit uuid is null')
			return commit.uuid
		})
		await orm(QUEUE_COMMIT_MODEL).deleteMany({ 'commit.uuid': { $in: removedCommitUUID } })
	})

	async function tryResend() {
		const remainCommit = await orm(QUEUE_COMMIT_MODEL).count()
		if (!orm.isMaster() && remainCommit && !orm.getQueue('queue:send').length) {
			debug('Retry sending commit !', dayjs().toDate())
			orm.emit('queue:send')
		}
	}
	const tryResendInterval = setInterval(() => {
		tryResend()
	}, 10000)

	const doSend = async () => {
		debug('Try to send to master')
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
