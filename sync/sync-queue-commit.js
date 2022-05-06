const QUEUE_COMMIT_MODEL = 'QueueCommit'
const dayjs = require('dayjs')
const _ = require('lodash')
const { EVENT_CONSTANT } = require('./sync-log')

module.exports = function (orm) {
	let disabled = false

	orm.disableQueue = disableQueue
	orm.enableQueue = enableQueue

	function disableQueue() {
		disabled = true
	}
	function enableQueue() {
		disabled = false
	}

	const clearQueue = async () => {
		if (orm.isMaster && orm.isMaster()) {
			clearInterval(intervalClearQueue)
			return
		}
		const clearDate = dayjs().subtract(1, 'day').toDate()
		await orm(QUEUE_COMMIT_MODEL).deleteMany({
			dateAdded: { '$exists': false }
		})
		await orm(QUEUE_COMMIT_MODEL).deleteMany({
			dateAdded: { '$lte': clearDate }
		})
	}

	const intervalClearQueue = setInterval(clearQueue, 3 * 60 * 60 * 1000)

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
		orm.writeSyncLog(EVENT_CONSTANT.ADDED_TO_QUEUE, commit._id)
		if (orm.getQueue('queue:send').length <= 1)
			orm.emit('queue:send')
	})

	orm.onQueue('transport:finish:send', async function (_queueCommit) {
		const removedCommitUUID = _queueCommit.map((commit) => {
			return commit._id
		})
		orm.writeSyncLog(EVENT_CONSTANT.FINISH_SEND, removedCommitUUID)
		await orm(QUEUE_COMMIT_MODEL).deleteMany({ 'commit._id': { $in: removedCommitUUID } })
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
		if (disabled) return
		console.log('Try to send to master')
		const data = await orm(QUEUE_COMMIT_MODEL).find()
		try {
			orm.writeSyncLog(EVENT_CONSTANT.DO_SEND, data.map(item => item.commit._id))
		} catch (e) {
			console.error(e)
		}
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
